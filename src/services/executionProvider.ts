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

import { LocalExecutionProvider } from './executionProviders/localExecutionProvider.js';
import { MultiAgentToolContext, ToolExecutionEnvironmentType } from '../momoa_core/types.js';

export interface ExecutionHandle {
  executionId: string;
  checkProgress: () => Promise<ExecutionResponse[]>;
  isDone: () => Promise<boolean>;
}

export interface FilePayload {
  path: string;
  content: string;
  isBinary: boolean;
}

export interface ProcessHandle {
  writeStdin: (data: string) => Promise<void>;
  kill: () => Promise<void>;
}

export interface ExecutionRequest {
  command: string;
  cwd?: string;
  args?: string[];
  files?: FilePayload[];
  envs?: NodeJS.ProcessEnv[]; 
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onProcessCreated?: (handle: ProcessHandle) => void;
  onTaskComplete?: (result: ExecutionResponse) => void;
  estimatedTaskDurationMs?: number;
  estimatedTaskPeakMemory?: number;
}

export interface ExecutionResponse {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  generatedFiles: FilePayload[];
  error?: string;
  durationMs?: number;
  peakMemory?: number;
  index?: number;
}

export interface ExecutionProvider {
  providerName: string;
  isPersistentSandbox: boolean;
  stageFiles(files: FilePayload[], targetDir: string): Promise<void>;
  execute(request: ExecutionRequest): Promise<ExecutionResponse>;
  cleanupSandbox(): Promise<void>;
}

export function getExecutionProvider(context: MultiAgentToolContext | undefined): ExecutionProvider | undefined {
  if (!context)
    return new LocalExecutionProvider();
  
  switch (context.toolExecutionEnvironment) {
    case (ToolExecutionEnvironmentType.Local): 
    default: 
      return new LocalExecutionProvider();
  }
}