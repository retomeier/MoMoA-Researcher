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

import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { getAssetString } from '../../services/promptManager.js';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import { addDynamicallyRelevantFile, updateFileEntry } from '../../utils/fileAnalysis.js';

const LARGE_FILE_LIMIT_KB = 100;

const cache = new Map<string, MultiAgentToolResult>();

/**
 * Implements the URL Fetch Tool, providing functionality to fetch content
 * from a given URL using the 'fetch' API.
 * * This tool now automatically saves downloaded files to the project context.
 * * Large text files are saved as "binary" to hide them from the diff, but a snippet is returned.
 */
export const urlFetchTool: MultiAgentTool = {
  displayName: "URL Fetcher",
  name: 'URL/FETCH{',
  endToken: '}',

  /**
   * Executes the URL fetch tool.
   * @param params The parameters for the tool's execution, expecting a 'url' property.
   * @param context The ToolContext object containing necessary runtime information.
   * @returns A promise that resolves to the URL's content or an error message.
   */
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const providedUrl = params.url;

    if (!providedUrl) {
      return {
        result: `Error: 'url' parameter is missing for ${this.displayName} tool.`
      };
    }
    
    const url = providedUrl.trim();

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
            result: `Error: Invalid URL. Must start with 'http://' or 'https://'.`
        };
    }

    // Check cache (Only for things previously determined to be pure text content/webpages)
    if (cache.has(url)) {
      context.sendMessage({
          type: 'PROGRESS_UPDATE',  
          message: `Using cached content from \`${url}\``,
        }
      );
      return cache.get(url)!;
    }

    // Cache Miss: Proceed with fetch
    context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: `Fetching content from \`${url}\``,
      }
    );

    try {
      const response = await fetch(url);

      // This block handles HTTP errors (e.g., 404, 503) - DO NOT CACHE
      if (!response.ok) {
        return {
          result: `Error: Failed to fetch URL '${url}'. Server responded with HTTP Status: ${response.status} (${response.statusText})`
        };
      }

      // --- FILE DOWNLOAD & CONTENT ANALYSIS ---
      
      // 1. Determine Filename
      let filename = '';
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      if (!filename) {
        try {
          const urlObj = new URL(url);
          filename = path.basename(urlObj.pathname);
        } catch (e) {
          // Ignore URL parsing errors
        }
      }

      // 2. Fetch Content & Analyze Type
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      
      // Heuristic: Is this text? (Includes JSON, XML, JS, TS, HTML, plain text)
      const isText = contentType.includes('text/') || 
                     contentType.includes('json') || 
                     contentType.includes('xml') || 
                     contentType.includes('javascript') || 
                     contentType.includes('typescript') ||
                     contentType.includes('application/x-sh');

      // Heuristic: Is this a file download or a webpage?
      const isHtml = contentType.includes('text/html');
//      const hasFileExtension = filename.includes('.') && !filename.match(/\.(html|htm|php|asp|jsp)$/i);
      const isLarge = buffer.length > LARGE_FILE_LIMIT_KB * 1024;

      // We save as a file if:
      // A. It has a file extension AND is not a generic webpage
      // B. OR it is explicitly not text (Binary)
      // C. OR it is text but "Large" (automatically treated as a file asset)
      const shouldSaveAsFile = (filename && !isHtml) || !isText || isLarge;

      if (shouldSaveAsFile && filename) {
        // --- SAVE TO PROJECT CONTEXT ---
        
        let resultMessage = '';
        const analysisDescription = `[Downloaded Asset] Content fetched from ${url}`;

        // Case A: Small Text File -> Save to fileMap (Visible in Diff)
        if (isText && !isLarge) {
            const content = buffer.toString('utf-8');
            
            // Ensure no conflict in binary map
            if (context.binaryFileMap.has(filename)) context.binaryFileMap.delete(filename);

            context.fileMap.set(filename, content);
            context.editedFilesSet.add(filename);
            addDynamicallyRelevantFile(filename);
            await updateFileEntry(filename, context.fileMap, undefined, {
                filename,
                description: analysisDescription,
                relatedFiles: ''
            });

            context.sendMessage({
                type: 'PROGRESS_UPDATE',
                message: `Successfully downloaded \`${filename}\` (${buffer.length} bytes).`,
              }
            );

            return {
                result: `Successfully downloaded '${filename}' (${buffer.length} bytes).\nSaved to project files (Visible in Diff).\n\n--- Content ---\n${content}`,
                transcriptReplacementID: url,
                transcriptReplacementString: `--- Downloaded file '${filename}' ---`
            };
        } 
        
        // Case B: Large Text OR Binary -> Save to binaryFileMap (Hidden from Diff)
        // We use binaryFileMap for large text files to prevent them from flooding the LLM context via the Diff.
        const base64Content = buffer.toString('base64');
        
        // Ensure no conflict in text map
        if (context.fileMap.has(filename)) context.fileMap.delete(filename);

        context.binaryFileMap.set(filename, base64Content);
        context.editedFilesSet.add(filename);
        addDynamicallyRelevantFile(filename);
        await updateFileEntry(filename, context.fileMap, undefined, {
             filename,
             description: isText ? `${analysisDescription} (Large Text)` : `${analysisDescription} (Binary)`,
             relatedFiles: ''
        });

        if (isText) {
          const snippet = buffer.subarray(0, LARGE_FILE_LIMIT_KB*1000).toString('utf-8');
          resultMessage = `Successfully downloaded '${filename}' (${buffer.length} bytes).\n` +
                          `Saved to project files as a large asset (Hidden from Diff to save context).\n\n` +
                          `--- First ${LARGE_FILE_LIMIT_KB}KB Snippet of '${filename}' ---\n${snippet}\n\n... (remaining content saved to file) ...`;
        } else {
          resultMessage = `Successfully downloaded '${filename}' (${buffer.length} bytes).\n` +
                          `Saved to project files (Binary).\n[Binary content hidden]`;
        }

        context.sendMessage({
            type: 'PROGRESS_UPDATE',
            message: `Successfully downloaded '${filename}' (${buffer.length} bytes).`,
          }
        );

        return {
            result: resultMessage,
            transcriptReplacementID: url,
            transcriptReplacementString: `--- Downloaded large/binary file '${filename}' ---`
        };
      }

      // --- FALLBACK: GENERIC WEBPAGE CONTENT ---
      // (This path is taken for small HTML pages or content without filenames, usually just for reading)
      
      const prefix = await getAssetString('url-content-prefix');
      const suffix = await getAssetString('url-content-suffix');
      const replacementString = await getAssetString('url-content-removed');

      const content = buffer.toString('utf-8');

      context.sendMessage({
          type: 'PROGRESS_UPDATE',
          message: `\`\`\`\`\n${content}\n\`\`\`\``,
        }
      );

      const toolResult: MultiAgentToolResult = {
        result: `${prefix}\n${content}\n${suffix}`,
        transcriptReplacementID: url,
        transcriptReplacementString: `${prefix}\n${replacementString}\n${suffix}`
      };

      cache.set(url, toolResult);
      return toolResult;

    } catch (error) {
      // This block handles network errors (e.g., DNS failure, connection refused) - DO NOT CACHE
      const errorMessage = error instanceof Error ? error.message : String(error);

      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: errorMessage,
      });
      
      return {
        result: `Error: Network failure while fetching URL '${url}'. Details: ${errorMessage}`
      };
    }
  },

  /**
   * Extract parameters from the tool invocation string.
   * @param invocation The string used to invoke the tool.
   * @returns The parameter names and corresponding values.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    if (invocation.trim().endsWith("}")) {
      const url = invocation.trim().slice(0, -1).trim();
      return {
        success: true, 
        params: {
          url
        }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax for the ${this.displayName} Tool. Make sure you include the curly brackets.`
      }
    }
  }
};

/**
 * Generates a formatted string of the current cache contents.
 * @returns A string listing all cached URLs and their content.
 */
export function getFormattedCacheContents(): string {
  const entries: string[] = [];

  for (const [url, toolResult] of cache.entries()) {
    // The 'result' property holds the full content, including prefixes/suffixes,
    // which is what was cached.
    const content = toolResult.result;

    const entryString = [
      `URL: ${url}`,
      `Content:`,
      '```',
      content,
      '```'
    ].join('\n');
    
    entries.push(entryString);
  }

  // Join all entries with the "----" separator
  return entries.join('\n----\n');
}