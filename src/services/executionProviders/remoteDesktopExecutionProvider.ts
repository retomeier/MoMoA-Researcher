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

import { randomUUID } from 'crypto';
import { ExecutionProvider, ExecutionRequest, ExecutionResponse, FilePayload } from '../executionProvider.js';
import { db } from '../../firebase_server.js';

export class RemoteDesktopExecutionProvider implements ExecutionProvider {
    providerName = "Remote Desktop Agent";
    isPersistentSandbox = false;

    constructor(
        private agentId: string 
    ) { }

    private log(message: string) {
        console.log(`[FirebaseAgentProvider] ${new Date().toISOString()} - ${message}`);
    }

    async cleanupSandbox(): Promise<void> {
    
    }

    async stageFiles(_files: FilePayload[], _targetDir: string): Promise<void> {
        
    }

    async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
        this.log(`Dispatching execution request to Agent: ${this.agentId}`);
        
        const envsToRun = [...(request.envs && request.envs.length > 0 ? request.envs : [{}])];
        const totalTasks = envsToRun.length;
        const results: ExecutionResponse[] = new Array(totalTasks);
        
        let processedCount = 0;
        let allSucceeded = true;
        let lastError = '';

        const taskPromises = envsToRun.map(async (taskEnv, index) => {
            const taskId = randomUUID();
            const taskRef = db.ref(`agent_tasks/${this.agentId}/${taskId}`);

            try {
                // 1. Write the Request to Firebase
                await taskRef.child('request').set({
                    command: request.command,
                    args: request.args,
                    env: taskEnv,
                    files: request.files || [], 
                    timeoutMs: request.timeoutMs || 600000,
                    timestamp: Date.now()
                }).catch((err) => {
                    this.log(`Firebase write interrupted or failed: ${err.message}`);
                    throw err;
                });

                // 2. Wait for the Response (The proxy endpoint will populate this!)
                const response = await this.waitForResponse(taskRef, request.timeoutMs || 120000);
                
                if (response.exitCode !== 0) {
                    allSucceeded = false;
                    if (response.error || response.stderr) {
                        lastError = response.error || response.stderr;
                    }
                }

                (response as any).config = taskEnv;
                
                if (request.onTaskComplete) {
                    request.onTaskComplete(response);
                }

                results[index] = response;

            } catch (error: any) {
                allSucceeded = false;
                lastError = error.message;
                results[index] = {
                    stdout: '', stderr: '', exitCode: 1, timedOut: false, generatedFiles: [],
                    error: `Agent Provider Error: ${error.message}`
                } as any;
            } finally {
                // 3. Clean up the task from Firebase
                await taskRef.remove().catch(() => {});
                processedCount++;
            }
        });

        await Promise.all(taskPromises);

        if (totalTasks === 1) return results[0];

        return {
            stdout: `Successfully processed ${processedCount} tasks via Agent.`,
            stderr: allSucceeded ? '' : `One or more tasks failed. Last error: ${lastError}`,
            exitCode: allSucceeded ? 0 : 1,
            timedOut: false,
            generatedFiles: [],
        };
    }

    private waitForResponse(taskRef: any, timeoutMs: number): Promise<ExecutionResponse> {
        return new Promise((resolve, reject) => {
            let isResolved = false;
            const responseRef = taskRef.child('response');

            const timer = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    responseRef.off('value'); 
                    reject(new Error(`Agent timed out after ${timeoutMs}ms without responding.`));
                }
            }, timeoutMs + 10000); // 10s buffer

            responseRef.on('value', (snapshot: any) => {
                const val = snapshot.val();
                if (val && !isResolved) {
                    isResolved = true;
                    clearTimeout(timer);
                    responseRef.off('value'); 
                    const executionResponse: ExecutionResponse = {
                        ...val,
                        generatedFiles: val.generatedFiles || []
                    };
                    resolve(executionResponse);
                }
            });
        });
    }
}