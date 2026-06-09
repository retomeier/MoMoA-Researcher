/**
 * Copyright 2026 Reto Meier
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// --- Configuration ---
const AGENT_ID = process.env.AGENT_ID;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3007";
const POLL_INTERVAL_MS = 3000; 
const rawDocsPath = process.argv[2];
const DOCS_PATH = rawDocsPath ? path.resolve(rawDocsPath) : undefined;

if (!DOCS_PATH) {
    console.warn("WARNING: No docs path provided via CLI arguments. Fact finder tasks will fail.");
    console.warn("Usage: node localComputeCLI.mjs <path_to_docs_folder>");
} else 
    console.log(`Local Docs Path: ${DOCS_PATH}`);

const MAX_CONTEXT_FILE_SIZE_BYTES = 1048576; 
const LARGE_FILE_LIMIT_KB = 512; 
const MAX_MEM_PERCENTAGE = 0.8; // Use up to 80% of free memory

// Concurrency tracker based on host hardware
const CONCURRENCY_LIMIT = Math.max(1, os.cpus().length);
let activeTasks = 0;

if (!AGENT_ID) {
    console.error("CRITICAL ERROR: Please provide an AGENT_ID environment variable.");
    process.exit(1);
}

async function getMemoryUsage(pid) {
    try {
        const { stdout } = await execAsync(`ps -o rss= -p ${pid}`);
        const rssKb = parseInt(stdout.trim(), 10);
        return isNaN(rssKb) ? 0 : rssKb * 1024; 
    } catch (error) {
        return 0; 
    }
}

console.log(`Starting Local Execution Agent: ${AGENT_ID}...`);
console.log(`Hardware detected: ${CONCURRENCY_LIMIT} CPU cores. Agent will run up to ${CONCURRENCY_LIMIT} tasks concurrently.`);

// --- Polling Loop ---
async function pollForTasks() {
    // 1. Throttle if we are at max hardware capacity
    if (activeTasks >= CONCURRENCY_LIMIT) {
        setTimeout(pollForTasks, 1000); 
        return;
    }

    try {
        const res = await fetch(`${SERVER_URL}/api/agent/poll`, {
            headers: { 'Authorization': `Bearer ${AGENT_ID}` }
        });
        
        if (res.status === 200) {
            const data = await res.json();
            activeTasks++; // Reserve a CPU core
            
            console.log(`[+] Received Task: ${data.taskId} (Active Tasks: ${activeTasks}/${CONCURRENCY_LIMIT})`);
            
            // Fire and forget: Handle the task in the background so polling can continue
            handleSingleTask(data).finally(() => {
                activeTasks--; // Release the CPU core when done
            });
            
            // Instantly poll again to see if there are more tasks waiting to fill our CPU cores
            setTimeout(pollForTasks, 0);
            return;
        } 
    } catch (err) {
        // Suppress connection errors during polling
    }

    // Schedule the next standard poll if no tasks were found
    setTimeout(pollForTasks, POLL_INTERVAL_MS);
}

// --- Task Processing Wrapper ---
async function handleSingleTask(data) {
    const { taskId, request } = data;
    const result = await executeLocalTask(request);
    
    try {
        const postRes = await fetch(`${SERVER_URL}/api/agent/result?taskId=${taskId}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AGENT_ID}`
            },
            body: JSON.stringify(result)
        });
        
        if (postRes.status === 200) {
            console.log(`[+] Task ${taskId} complete. Results uploaded successfully.`);
        } else {
            console.error(`[-] Failed to upload results for Task ${taskId}. Status: ${postRes.status}`);
        }
    } catch (err) {
        console.error(`[-] Network error uploading results for Task ${taskId}:`, err.message);
    }
}

// --- Execution & Sweeping Logic ---
async function executeLocalTask(request) {
    const localStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    const originalFilesMap = new Map();
    let timedOut = false;
    
    // Default to the temporary staging directory
    let executionCwd = localStagingDir;
    const providedFiles = request.files || [];

    // 1) Generalize: If no files are provided, run from the CLI's current directory
    if (providedFiles.length === 0) {
        executionCwd = process.cwd();
    }

    try {
        for (const file of providedFiles) {
            const destPath = path.join(localStagingDir, file.path);
            originalFilesMap.set(path.normalize(file.path), file.content);
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.writeFile(destPath, Buffer.from(file.content, 'base64'));
        }

        const env = { ...process.env, ...(request.env || {}) };
        let args = [...(request.args || [])];

        // 2) Generalize: Check if the first argument is a script that exists only on the host
        const interpreters = [
            'node', 'bun', 'deno',             // JavaScript/TypeScript
            'python', 'python3', 'py',         // Python
            'ruby', 'perl', 'php',             // Scripting
            'go', 'rustc',                     // Compiled (if running source)
            'sh', 'bash', 'zsh', 'fish',       // Shells
            'java', 'kotlin',                  // JVM
            'dotnet', 'powershell', 'pwsh'     // .NET / Windows
        ];        
        if (interpreters.includes(request.command) && args.length > 0) {
            const scriptName = args[0];
            const scriptInStaging = path.join(localStagingDir, scriptName);
            
            try {
                // Check if the file exists in the staging directory
                await fs.access(scriptInStaging);
            } catch (e) {
                // File NOT in staging. Check if it exists in the host's current directory
                const hostScriptPath = path.resolve(process.cwd(), scriptName);
                try {
                    await fs.access(hostScriptPath);
                    // It exists on host! Switch context to host directory
                    executionCwd = process.cwd();
                    args[0] = hostScriptPath; // Use absolute path to ensure it's found
                } catch (hostErr) {
                    // Script not found in either location; proceed as normal (will likely fail in spawn)
                }
            }

            if (scriptName.endsWith('local_fact_finder.js')) {
                if (DOCS_PATH) {
                    // Ensure we don't double-inject if it somehow already has it
                    if (args.length < 2 || args[1] !== DOCS_PATH) {
                        args.splice(1, 0, DOCS_PATH);
                    }
                } else {
                    return { stdout: '', stderr: 'No DOCS_PATH provided to agent.', exitCode: 1, generatedFiles: [] };
                }
            }
        }
        
        // Conditionally Apply OS Memory Limits (Linux only)
        if (os.platform() === 'linux' && request.command === 'sh' && args[0] === '-c') {
            try {
                const availableMemKB = Math.floor(os.freemem() / 1024);
                // Divide memory safely among concurrent workers so they don't collectively OOM
                const workerMemLimitKB = Math.floor((availableMemKB * MAX_MEM_PERCENTAGE) / CONCURRENCY_LIMIT);
                args[1] = `ulimit -v ${workerMemLimitKB} && ${args[1]}`;
            } catch (memErr) {
                console.warn("Failed to apply OS memory limits:", memErr);
            }
        }
        const startTime = Date.now();
        const { stdout, stderr, exitCode, timeoutTriggered, peakMemory } = await new Promise((resolve) => {
            const child = spawn(request.command, args, { cwd: executionCwd, env, shell: true });

            if (child.stdin)
              child.stdin.end();

            let out = '', err = '', isDone = false;
            let peakMemoryTracker = 0, memInterval = null;

            let isPollingMem = false;
            if (child.pid) {
                memInterval = setInterval(async () => {
                    if (isPollingMem) return;
                    isPollingMem = true;
                    const currentMem = await getMemoryUsage(child.pid);
                    if (currentMem > peakMemoryTracker) peakMemoryTracker = currentMem;
                    isPollingMem = false;
                }, 100); 
            }

            const cleanup = () => {
                isDone = true;
                if (memInterval) clearInterval(memInterval);
            };

            const appendLog = (currentLog, newData) => {
                const combined = currentLog + newData;
                const maxSize = LARGE_FILE_LIMIT_KB * 2 * 1024;
                return combined.length > maxSize ? `[---Truncated---]\n${combined.slice(-maxSize)}` : combined;
            };

            child.stdout.on('data', d => { out = appendLog(out, d.toString()); });
            child.stderr.on('data', d => { err = appendLog(err, d.toString()); });

            const timer = setTimeout(() => {
                if (!isDone) {
                    cleanup();
                    child.kill('SIGKILL');
                    resolve({ stdout: out, stderr: err, exitCode: 1, timeoutTriggered: true, peakMemory: peakMemoryTracker });
                }
            }, request.timeoutMs || 120000);

            child.on('close', (code) => {
                if (!isDone) {
                    cleanup();
                    clearTimeout(timer);
                    resolve({ stdout: out, stderr: err, exitCode: code, timeoutTriggered: false, peakMemory: peakMemoryTracker });
                }
            });
            
            child.on('error', (error) => {
                 if (!isDone) {
                    cleanup();
                    clearTimeout(timer);
                    resolve({ stdout: out, stderr: err + error.message, exitCode: 1, timeoutTriggered: false, peakMemory: peakMemoryTracker });
                 }
            });
        });

        timedOut = timeoutTriggered;
        const durationMs = Date.now() - startTime;

        const responseFiles = [];
        const allFiles = await getFilesRecursively(localStagingDir);
        for (const fullPath of allFiles) {
            const relativePath = path.relative(localStagingDir, fullPath);
            const baseName = path.basename(relativePath);

            if (baseName.startsWith('.') || relativePath.includes('__pycache__') || baseName === 'target' || relativePath.startsWith('target/') || baseName === 'main_bin') continue;

            const stats = await fs.stat(fullPath);
            if (stats.isFile() && stats.size <= MAX_CONTEXT_FILE_SIZE_BYTES) {
                const contentBuffer = await fs.readFile(fullPath);
                const isBinary = contentBuffer.subarray(0, 1024).includes(0);
                const isTooLarge = contentBuffer.length > (LARGE_FILE_LIMIT_KB * 1024);

                const newContentBase64 = contentBuffer.toString('base64');
                const originalContent = originalFilesMap.get(path.normalize(relativePath));
                
                if (originalContent === undefined || originalContent !== newContentBase64) {
                    responseFiles.push({ path: relativePath, content: newContentBase64, isBinary: isBinary || isTooLarge });
                }
            }
        }

        return { stdout, stderr, exitCode, timedOut, durationMs, peakMemory, generatedFiles: responseFiles };

    } catch (err) {
        console.log(`[-] Execution Error: ${err.message}`);
        return { stdout: '', stderr: err.message, exitCode: 1, timedOut: false, durationMs: 0, peakMemory: 0, generatedFiles: [], error: err.message };
    } finally {
        await fs.rm(localStagingDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function getFilesRecursively(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const res = path.join(dir, entry.name);
        return entry.isDirectory() ? getFilesRecursively(res) : res;
    }));
    return Array.prototype.concat(...files);
}

async function startAgent() {
    console.log(`Starting Local Execution Agent: ${AGENT_ID}...`);
    try {
        const clearRes = await fetch(`${SERVER_URL}/api/agent/clear`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AGENT_ID}` }
        });
        if (clearRes.status === 200) 
            console.log(`[+] Successfully synchronized with server. Pending tasks cleared.`);
        else
            console.log(`[-] Failed to clear pending tasks: ${clearRes.status}:${clearRes.statusText}`)
    } catch (err) {}

    console.log(`Polling ${SERVER_URL} for tasks every ${POLL_INTERVAL_MS}ms...`);
    pollForTasks();
}

startAgent();