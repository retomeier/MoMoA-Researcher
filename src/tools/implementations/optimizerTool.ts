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

import * as path from 'path';
import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolResult, MultiAgentToolContext, ToolParsingResult } from '../../momoa_core/types.js';
import { addDynamicallyRelevantFile, updateFileEntry } from '../../utils/fileAnalysis.js';
import { MAX_SCRIPT_EXECUTION_TIMEOUT, logFilename } from '../../config/config.js';
import { ExecutionRequest, FilePayload, getExecutionProvider } from '../../services/executionProvider.js';

const MAX_TOTAL_RUNS = 200;
const TIMEOUT = MAX_SCRIPT_EXECUTION_TIMEOUT;

const calculateStats = (values: number[]) => {
    if (values.length === 0) return { mean: 0, std: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return { mean, std: Math.sqrt(variance) };
};

export const OptimizerTool: MultiAgentTool = {
  displayName: "Optimizer Tool",
  name: 'OPTIMIZE{',
  endToken: '}OPTIMIZE',

  async execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const updateProgress = (message: string | Promise<string>) => {
        context.sendMessage({
          type: 'PROGRESS_UPDATE',
          message: message,
        });
    };

    const updateLog = (message: string) => {
        context.sendMessage({
          status: 'WORK_LOG',
          message: message,
        });
    };

    // 1. Inputs & Provider Selection
    let evalScript = params['evaluator_script'] as string;
    let searchSpace = params['search_space'] as Record<string, any>;
    const goal = (params['goal'] as string || 'min').toLowerCase();
    const budget = Number(params['budget']) || 0;
    const trials = Number(params['trials']) || 1;
    const dependencies = (params['dependencies'] as string[]) || [];

    console.log(`Exec Env at Tool: ${context.toolExecutionEnvironment}`);
    let provider = getExecutionProvider(context); 

    if (!provider) {
        updateProgress(`Requested tool execution environment (${context.toolExecutionEnvironment}) is unavailable. Using default 'Local' environment.`);
        provider = getExecutionProvider(undefined);
        if (!provider) {
            updateProgress(`No tool execution environment available. Cancelling Tool.`);
            const noEnvironmentString = `Error running tool: No execution environment was availble. Requested '${context.toolExecutionEnvironment}' which was unavailable. Defaulted to 'Local' which also failed. Tool is unavailable at this time.`;
            return { result: noEnvironmentString };
        }
    }
   
    updateProgress(`Running code via ${provider.providerName}.`);

    // Support "module:function" syntax for Evaluator (Driver)
    let entryPointFunction = null;
    if (evalScript.includes(':')) {
        const parts = evalScript.split(':');
        evalScript = parts[0];       
        entryPointFunction = parts[1]; 
    }

    const isRust = evalScript.endsWith('.rs');
    const isPython = evalScript.endsWith('.py');

    if (isRust && entryPointFunction) {
       return { result: "Error: Syntax `script:function` is only supported for Python. For Rust, the binary must run directly." };
    }


    updateProgress(`Conducting Optimization using ${provider.providerName} (${isRust ? 'Rust' : 'Python'}):\n* Evaluator: \`${evalScript}\`\n* Goal: ${goal}\n* Budget: ${budget}\n* Trials: ${trials}`);

    // 2. Prepare Files to Stage
    const filesToStage: FilePayload[] = [];
    const allPaths = [evalScript, ...dependencies];

    for (const filePath of allPaths) {
        if (context.fileMap.has(filePath)) {
            filesToStage.push({
                path: filePath,
                content: Buffer.from(context.fileMap.get(filePath)!).toString('base64'),
                isBinary: false
            });
        } else if (context.binaryFileMap.has(filePath)) {
            filesToStage.push({
                path: filePath,
                content: context.binaryFileMap.get(filePath)!,
                isBinary: true
            });
        } else {
            return { result: `Error: File '${filePath}' not found in context.` };
        }
    }

    // 3. Generate Jobs
    let jobs: Record<string, string>[] = [];

    // STRATEGY A: RANDOM SEARCH (if budget > 0)
    if (budget > 0) {
        // Random Search
        updateProgress('Conducting Random Search.');
        for (let i = 0; i < budget; i++) {
            const job: Record<string, string> = {};
            for (const [key, value] of Object.entries(searchSpace)) {
                // Handle Range Objects: {"min": 0, "max": 10}
                if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'min' in value) {
                    const min = Number(value.min);
                    const max = Number(value.max);
                    const isInt = value.type === 'int';
                    let val = Math.random() * (max - min) + min;
                    if (isInt) val = Math.round(val);
                    job[key] = isInt ? String(val) : val.toFixed(4);
                } else if (Array.isArray(value)) {
                    job[key] = String(value[Math.floor(Math.random() * value.length)]);
                } else {
                    job[key] = String(value);
                }
            }
            jobs.push(job);
        }
    } else {
        // Grid Search
        updateProgress('Conducting Grid Search.');
        jobs = [{}];
        for (const key of Object.keys(searchSpace)) {
            const rawValues = Array.isArray(searchSpace[key]) ? searchSpace[key] : [searchSpace[key]];
            const values = rawValues.map((v: any) => String(v));
            const newJobs: Record<string, string>[] = [];
            for (const base of jobs) {
                for (const val of values) {
                    newJobs.push({ ...base, [key]: val });
                }
            }
            jobs = newJobs;
        }
    }

    // Safety Check
    const totalExecutions = jobs.length * trials;
    if (totalExecutions > MAX_TOTAL_RUNS) {
        const result = `Error: Too many runs requested (${totalExecutions}). Limit is ${MAX_TOTAL_RUNS}. Reduce budget or trials.`;
        updateProgress(result);
        return { result: result };
    }

     // 4. Execution Loop using Provider

    // --- PREPARATION: Compile or Wrap ---
    let trialCommand = '';
    let trialArgs: string[] = [];
    let executableScript = path.basename(evalScript);
    const additionalFiles: FilePayload[] = [];

    const hasCargo = filesToStage.some(f => f.path.endsWith('Cargo.toml'));

    if (isRust) {
        if (hasCargo) {
            // For Cargo, we rely on the provider to handle the build/run cycle
            trialCommand = 'sh';
            trialArgs = ['-c', 'cargo run --release --quiet'];
        } else {
            // Single file: Compile directly on the target execution environment
            // Each task runs in an isolated directory, so concurrent compiles won't collide.
            updateProgress("Configuring target environment for standalone Rust compilation...");
            trialCommand = 'sh';
            trialArgs = ['-c', `rustc ${evalScript} -o main_bin && ./main_bin`];
        }
    } else if (isPython && entryPointFunction) {
        const moduleName = path.basename(evalScript, '.py');
        const wrapperContent = `
import sys
import ${moduleName}

try:
    # Call the function dynamically
    result = ${moduleName}.${entryPointFunction}()
    print(f"[OPTIMIZER_METRIC]: {result}")
except Exception as e:
    print(f"Wrapper Error: {e}", file=sys.stderr)
    sys.exit(1)
    `.trim();
        executableScript = `__momoa_wrapper.py`;
        additionalFiles.push({
            path: executableScript,
            content: Buffer.from(wrapperContent).toString('base64'),
            isBinary: false
        });

        trialCommand = 'python3'; // (or 'python' depending on your container)
        trialArgs = [executableScript];
    } else {
        trialCommand = 'python3'; 
        trialArgs = [executableScript];
    }

    // --- 4. Dry Run (Validation) ---
    // Run once with the first job's config to ensure the script isn't broken
    updateProgress("Initiating dry run.");
    const dryRunRes = await provider.execute({
        command: trialCommand,
        args: trialArgs,
        files: [...filesToStage, ...additionalFiles],
        envs: [{ ...jobs[0] }],
        timeoutMs: TIMEOUT
    });

    updateLog(`Dry run Result: ${dryRunRes.stdout}`);   
    updateLog(`Dry run exit code: ${dryRunRes.exitCode}`);     

    if (dryRunRes.exitCode !== 0 || !dryRunRes.stdout.includes('[OPTIMIZER_METRIC]')) {
        updateProgress(`Dry run failed: ${dryRunRes.stderr || dryRunRes.stdout || dryRunRes.error}`);        
        return { result: `Dry Run Failed: ${dryRunRes.stderr || dryRunRes.stdout || dryRunRes.error}` };
    }

    const estimatedTaskDurationMs = dryRunRes.durationMs || 60000; 
    const estimatedMemoryMb = dryRunRes.peakMemory || 500;
    updateProgress(`Dry run succeeded. Task took ${estimatedTaskDurationMs / 1000}s and used ${estimatedMemoryMb}Mb of memory.`);

    // 6. MAIN EXECUTION LOOP (Fully Parallelized)
    let bestScore = goal === 'max' ? -Infinity : Infinity;
    let bestParams: Record<string, string> = {};
    let bestStats = { mean: 0, std: 0 };
    let bestGeneratedFiles: FilePayload[] = [];
    const resultsLog: string[] = [];

    // Track results per job configuration
    // We stringify the job config to group the trial results together
    const jobResults = new Map<string, { scores: number[], files: FilePayload[], stdout: string }>();

    // FLATTEN JOBS AND TRIALS INTO ONE ARRAY OF ENVS
    const flattenedEnvs: NodeJS.ProcessEnv[] = [];
    for (const job of jobs) {
        for (let t = 0; t < trials; t++) {
            flattenedEnvs.push({
                ...job,
                RANDOM_SEED: String(Date.now() + t),
                // We add this so the handler knows which base job this trial belongs to
                _momoa_job_config: JSON.stringify(job) 
            });
        }
    }

    const executionRequest: ExecutionRequest = {
        command: trialCommand,
        args: trialArgs,
        files: [...filesToStage, ...additionalFiles],
        envs: flattenedEnvs, // <-- Using 'envs' array to trigger parallel tasks
        timeoutMs: TIMEOUT,
        estimatedTaskDurationMs: estimatedTaskDurationMs,
        estimatedTaskPeakMemory: estimatedMemoryMb,
        onTaskComplete: (res: any) => {

            const envUsed = res.config || {};
            const configStr = envUsed._momoa_job_config || '{}';
            const baseConfig = JSON.parse(configStr);

            // Group results for this specific job configuration
            if (!jobResults.has(configStr)) {
                jobResults.set(configStr, { scores: [], files: [], stdout: '' });
            }
            const group = jobResults.get(configStr)!;

            const m = res.stdout.match(/\[OPTIMIZER_METRIC\]:\s*([-\d\.eE]+)/);
            if (m) {
                group.scores.push(parseFloat(m[1]));
                group.files = res.generatedFiles || []; // Keep files from the latest run
                group.stdout = res.stdout;
                
                // If all trials for this specific job config are done, evaluate it!
                if (group.scores.length === trials) {
                    const stats = calculateStats(group.scores);
                    const isBetter = goal === 'max' ? (stats.mean > bestScore) : (stats.mean < bestScore);
                    const logSuffix = trials > 1 ? ` (µ=${stats.mean.toFixed(4)}, σ=${stats.std.toFixed(4)})` : ``;
                    
                    updateProgress(`Params: ${configStr} -> ${stats.mean.toFixed(4)}${logSuffix}`);
                    resultsLog.push(`Params: ${configStr} -> ${stats.mean.toFixed(4)}${logSuffix}\n---`);

                    if (isBetter) {
                        bestScore = stats.mean;
                        bestParams = baseConfig;
                        bestStats = stats;
                        bestGeneratedFiles = group.files;
                    }
                }
            } else {
                resultsLog.push(`Params: ${configStr} -> Failed on a trial. Details:\n${res.stderr || res.stdout}`);
            }
        }
    };

    // Actually trigger the execution!
    updateProgress(`Triggering ${flattenedEnvs.length} parallel tasks (Jobs: ${jobs.length}, Trials: ${trials})...`);
    
    const batchResult = await provider.execute(executionRequest);

    if (batchResult.exitCode !== 0 && resultsLog.length === 0) {
        return { result: `Batch Execution Failed: ${batchResult.stderr}` };
    }

    // 7. SYNC GENERATED FILES FROM BEST RUN
    const savedFiles: string[] = [];
    for (const genFile of bestGeneratedFiles) {
        let relativePath = genFile.path;
        let baseName = path.basename(relativePath);

        // Filter out system/temp files
        if (baseName.startsWith('.') || 
            relativePath.includes('__pycache__') || 
            baseName === 'target' || 
            relativePath.startsWith('target/') || 
            baseName === 'main_bin' || 
            baseName === '__wrapper.py') 
                continue;

        // Special handling for research logs consistent with Code Runner
        if (baseName.toUpperCase() === logFilename.toUpperCase()) {
            const dirName = path.dirname(relativePath);
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            baseName = `OPTIMIZER_RESEARCH_LOG_${timestamp}.md`;
            relativePath = dirName === '.' ? baseName : path.join(dirName, baseName);
        }

        if (genFile.isBinary) {
            context.binaryFileMap.set(relativePath, genFile.content);
        } else {
            const decodedText = Buffer.from(genFile.content, 'base64').toString('utf8');
            context.fileMap.set(relativePath, decodedText);
            await updateFileEntry(relativePath, context.fileMap, context.multiAgentGeminiClient);
        }

        context.editedFilesSet.add(relativePath);
        addDynamicallyRelevantFile(relativePath);
        savedFiles.push(relativePath);
    }

    // --- 7. Report ---
    // Return verbose errors if ALL failed
    if (resultsLog.every(l => l.includes('-> Failed. Details:'))) {
        updateProgress(`Optimization Failed (All runs failed)`);
        return { result: `Optimization Failed (All runs failed).\n\nErrors:\n${resultsLog.join('\n')}` };
    }

    const header = `Optimization Complete:`;
    const bestParamsString = `Best Params: ${JSON.stringify(bestParams)}`;
    const bestStr = trials > 1 ? `Best Mean: ${bestStats.mean.toFixed(4)} (StdDev: ${bestStats.std.toFixed(4)})` : `Best Score: ${bestScore}`;
    let bestFileNames = "";
    
    updateProgress(header);    
    updateProgress(bestParamsString);
    updateProgress(bestStr);

    if (bestGeneratedFiles.length > 0) {
        bestFileNames = `Files generated/updated (from best run): ${bestGeneratedFiles.join(', ')}`;
        updateProgress(bestFileNames);
    }

    const output = `${header}\n${bestParamsString}\n${bestStr}\n${bestFileNames ? bestFileNames + "\n" : ''}\nLog (Top 20):\n${resultsLog.slice(0, 20).join('\n')}`;

    return { result: output };
  },

  async extractParameters(invocation: string): Promise<ToolParsingResult> {
    const trimmed = invocation.trim();
    if (!trimmed.endsWith(this.endToken!)) return { success: false, error: `Invalid syntax.` };
    const content = trimmed.substring(0, trimmed.lastIndexOf(this.endToken!));
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    
    if (jsonStart < 0 || jsonEnd < 0) return { success: false, error: `JSON search space missing.` };

    const preJson = content.substring(0, jsonStart).trim();
    let files: string[] = [], deps: string[] = [];
    const bracketStart = preJson.indexOf('[');
    const bracketEnd = preJson.lastIndexOf(']');

    if (bracketStart !== -1 && bracketEnd > bracketStart) {
        // Part 1: Scripts (before brackets)
        const scriptsPart = preJson.substring(0, bracketStart);
        files = scriptsPart.split(/[,|]/).map(s => s.trim()).filter(s => s);
        
        // Part 2: Dependencies (inside brackets)
        const depsContent = preJson.substring(bracketStart + 1, bracketEnd);
        if (depsContent.trim().length > 0) {
            deps = depsContent.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
    } else {
        // Fallback: Legacy comma-separated format
        const parts = preJson.split(/[,|]/).map(s => s.trim()).filter(s => s);
        files = parts.slice(0, 1);
        deps = parts.slice(1);
    }

    if (files.length < 1) return { success: false, error: `Missing driver script.` };
    let searchSpace;
    try { searchSpace = JSON.parse(content.substring(jsonStart, jsonEnd+1)); } 
    catch(e) { return { success: false, error: `Invalid JSON.` }; }
    const args = content.substring(jsonEnd+1).split(/[,|]/).map(s=>s.trim()).filter(s=>s);
    
    return {
        success: true,
        params: {
            evaluator_script: files[0],
            dependencies: deps,
            search_space: searchSpace,
            goal: (args[0]||'min').replace(/['"]/g, '').toLowerCase(),
            budget: parseInt(args[1]||'0'),
            trials: parseInt(args[2]||'1')
        }
    };
  }
};