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
import { logFilename, MAX_SCRIPT_EXECUTION_TIMEOUT } from '../../config/config.js';
import { FilePayload, getExecutionProvider } from '../../services/executionProvider.js';

const EXECUTION_TIMEOUT_MS = MAX_SCRIPT_EXECUTION_TIMEOUT;

export const CodeRunnerTool: MultiAgentTool = {
  displayName: "Code Runner",
  name: 'RUN{',
  endToken: '}',

  /**
   * Stages files and executes them. Supports Python (.py) and Rust (.rs).
   */
  async execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const updateProgress = (message: string) => {
        context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: message,
        });
    };

    const files = params['files'] as string[];

    if (!files || files.length === 0) {
      updateProgress("Error: No files provided to execute.");
      return { result: "Error: No files provided to execute." };
    }

    const mainScript = files[0];
    const otherFiles = files.slice(1);
    const ext = path.extname(mainScript).toLowerCase();
    const isRust = ext === '.rs';
    const isPython = ext === '.py';

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

    if (!isRust && !isPython) {
        updateProgress(`Error: Unsupported file type '${ext}'`);
        return { result: `Error: Unsupported file type '${ext}'. Please provide .py or .rs files.` };
    }

    const filesToStage: FilePayload[] = [];
    for (const file of [mainScript, ...otherFiles]) {
        if (context.fileMap.has(file)) {
            filesToStage.push({
                path: file,
                content: Buffer.from(context.fileMap.get(file)!).toString('base64'),
                isBinary: false
            });
        } else if (context.binaryFileMap.has(file)) {
            filesToStage.push({
                path: file,
                content: context.binaryFileMap.get(file)!,
                isBinary: true
            });
        } else {
             return { result: `Error: File '${file}' not found in context.` };
        }
    }

    // Command Generation (Cleaned up, no memory logic here)
    let command = 'sh';
    let args: string[] = [];
    
    if (isPython) {
        updateProgress(`Executing Python script \`${mainScript}\``);
        args = ['-c', `python3 ${mainScript}`];
    } else if (isRust) {
        const hasCargo = files.some(f => f.endsWith('Cargo.toml'));
        if (hasCargo) {
            updateProgress(`Executing Rust Project (Cargo)`);
            args = ['-c', `cargo run --release --quiet`];
        } else {
            updateProgress(`Compiling and Executing Rust script \`${mainScript}\``);
            args = ['-c', `rustc ${mainScript} -o main_bin && ./main_bin`];
        }
    }

    const request = {
      command,
      args,
      files: filesToStage,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    };

    const executionResult = await provider.execute(request);

    if (executionResult.error) {
      updateProgress(`Execution failed: ${executionResult.error}`);
      return { result: `System Error: ${executionResult.error}` };
    }

    let resultStr = ``;
    if (executionResult.timedOut) resultStr += `Error: Execution timed out.\n`;
    else if (executionResult.exitCode !== 0) resultStr += `Error: Process exited with code ${executionResult.exitCode}.\n`;
    else resultStr += `Execution successful.\n`;

    const generatedFileNames: string[] = [];
    for (const genFile of executionResult.generatedFiles) {
        let relativePath = genFile.path;
        let baseName = path.basename(relativePath);
        if (baseName.toUpperCase() === logFilename.toUpperCase()) {
            const dirName = path.dirname(relativePath);
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            baseName = `CODE_RUNNER_RESEARCH_LOG_${timestamp}.md`;
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
        generatedFileNames.push(relativePath);
    }

    if (generatedFileNames.length > 0) {
        updateProgress(`The following files were generated: ${generatedFileNames.join(', ')}`);
        resultStr += `\nGenerated Files: ${generatedFileNames.join(', ')}\n`;
    }

    let progressString = `Execution of \`${mainScript}\` ${executionResult.exitCode === 0 ? "was successful:" : "failed:"}`;

    if (executionResult.stdout?.trim()) {
      resultStr += `\n--- STDOUT ---\n${executionResult.stdout.trim()}\n`;
      progressString += `\n\`\`\`\`\n${executionResult.stdout.trim()}\n\`\`\`\``
    }
    if (executionResult.stderr?.trim()) {
      resultStr += `\n--- STDERR ---\n${executionResult.stderr.trim()}\n`;
      progressString += `\nExit Code ${executionResult.exitCode}. \n\`\`\`\`\n${executionResult.stderr.trim()}\n\`\`\`\``
    }

    updateProgress(progressString);

    return { result: resultStr };
  },

  /**
   * Parses the syntax: RUN{file1.py, file2.py, ...}
   * Expects a comma-separated list of filenames.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    const trimmed = invocation.trim();
    
    // Remove the footer
    const endToken = this.endToken ?? '}';
    if (!trimmed.endsWith(endToken)) {
      return { success: false, error: `Invalid syntax: Must end with '${endToken}'` };
    }
    
    // Content is everything before the footer
    const content = trimmed.substring(0, trimmed.lastIndexOf(endToken));
    
    // Split by comma or pipe, trim whitespace, and remove empty entries
    const files = content
        .split(/[,|]/)
        .map(f => f.trim())
        .filter(f => f.length > 0);

    if (files.length === 0) {
        return { success: false, error: "No files specified." };
    }

    return {
        success: true,
        params: {
            files: files
        }
    };
  }
};