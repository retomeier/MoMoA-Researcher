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
import { addFAQ } from '../../utils/faqs.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { DEFAULT_GEMINI_LITE_MODEL, DEFAULT_GEMINI_PRO_MODEL } from '../../config/models.js';
import { getFilesAndContent, removeBacktickFences } from '../../utils/markdownUtils.js';
import { getAssetString, getToolPreamblePrompt, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { generateDiff } from '../../utils/diffGenerator.js';
import { getFormattedCacheContents } from './urlFetchTool.js';
import { Part } from '@google/genai';

/**
 * Implements the File Reader Tool, providing functionality to read file content
 * from an in-memory collection of files (Map). This tool does NOT read from disk.
 */
export const askExpertTool: MultiAgentTool = {
  displayName: "Ask an Expert",
  name: 'PHONEAFRIEND',

  /**
   * Executes the Ask an Expert tool.
   * @param params The parameters for the tool's execution, expecting a 'filename' property.
   * @param context The ToolContext object containing necessary runtime information.
   * @returns A promise that resolves to the file's content or an error message.
   */
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const updateLog = async (message: string, updateOverseerLog: boolean = true) => {
      context.sendMessage(JSON.stringify({
        status: 'WORK_LOG',
        message: message,
      }));
    
      if (updateOverseerLog)
        context.overseer?.addLog(message);
    };

    const question = params.question;

    updateLog(`${this.displayName} Invoked`);

    context.sendMessage(JSON.stringify({
      status: "PROGRESS_UPDATES",
      current_status_message: `Getting additional guidance from an 'Expert' (Spoiler: It's a bigger LLM with a special prompt).`,
    }));
       
    try {      
      let problemSummary = question;
      let requestedFiles = [];
      let fileNamesPlusContentString = "No files were provided.";
  
      const relevantFilesMarker = 'RELEVANT_FILES:';
      const fileMarkerIndex = question.indexOf(relevantFilesMarker);
  
      if (fileMarkerIndex !== -1) {
        problemSummary = question.substring(0, fileMarkerIndex).trim();
        const jsonString = question.substring(fileMarkerIndex + relevantFilesMarker.length).trim();
  
        try {
          const parsedFiles = JSON.parse(jsonString);
          if (Array.isArray(parsedFiles)) {
            requestedFiles = parsedFiles;
          } else {
            updateLog('RELEVANT_FILES section is not a JSON array');
          }
        } catch (jsonError) {
          updateLog(`Failed to parse RELEVANT_FILES JSON: ${jsonError}`);
          updateLog(`Problematic JSON string: ${jsonString}`);
        }
      } else {
        updateLog(`RELEVANT_FILES marker not found in question.`);
      }

      const urlContent = getFormattedCacheContents();
  
      fileNamesPlusContentString = await getFilesAndContent(requestedFiles, context);
  
      // Generate the unified diff
      const diffBlock = generateDiff(
        context.originalFileMap,
        context.fileMap,
        context.editedFilesSet,
        new Set(context.originalBinaryFileMap.keys())
      );
      const projectDiffString = diffBlock ? `${diffBlock}` : "---No changes detected---";
  
      let askExpertPrompt = await getToolPreamblePrompt('ask-expert-preamble');
      askExpertPrompt = await replaceRuntimePlaceholders(
        askExpertPrompt, 
        {
          ProblemSummary: problemSummary,
          RelevantFiles: fileNamesPlusContentString,
          URLContent: urlContent,
          ProjectDiff: projectDiffString,
          ProjectTask: context.initialPrompt,
          Assumptions: context.assumptions ?? "",
          Spec: context.projectSpecification ?? "--No Specification Provided--"
        });

      const parts: Part[] = [];
      
      // 1. Add Initial Context Image (if present)
      if (context.initialImage && context.initialImageMimeType) {
        parts.push({
          inlineData: {
            mimeType: context.initialImageMimeType, 
            data: context.initialImage,
          }
        });
      }

      // 2. Add Relevant Images from the File List
      // We iterate through requested files to see if any are binary images.
      for (const filename of requestedFiles) {
        if (context.binaryFileMap.has(filename)) {
            const mimeType = getImageMimeType(filename);
            const base64Data = context.binaryFileMap.get(filename);
            
            if (mimeType && base64Data) {
                parts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Data
                    }
                });
                updateLog(`Attaching relevant image file to expert prompt: ${filename}`);
            }
        }
      }

      // 3. Add the Text Prompt
      parts.push({ text: askExpertPrompt });

      const expertResponse = (await context.multiAgentGeminiClient.sendOneShotMessage(
        parts, 
        { 
          model: DEFAULT_GEMINI_PRO_MODEL,
          enableThinking: true,
         } 
      ));
      
      let expertOpinion = expertResponse?.text || "";
      expertOpinion = removeBacktickFences(expertOpinion).trim();

      if (!expertOpinion) {
        // Check the candidate for specific failure reasons
        const candidate = expertResponse.candidates?.[0];
        if (candidate) {
          if (candidate.finishReason !== 'STOP') {
            updateLog(`**Expert Tool Warning:** Response stopped due to: ${candidate.finishReason}`);
          }
          
          // Attempt to extract text from parts (including thoughts)
          expertOpinion = candidate.content?.parts
            ?.map(p => p.text)
            .join('\n')
            .trim() || "";
            
          if (expertOpinion) {
            updateLog("**Expert Tool:** Recovered text from raw parts (likely thought trace + partial answer).");
          }
        } else {
          updateLog("**Expert Tool Error:** No candidates returned in response.");
        }
      }

      if (!expertOpinion) {
        const nullResult = '[The expert provided a non-text response]';
        updateLog(nullResult);
        return { result: nullResult };
      }

      const result = "You asked an expert and this is what they said:\n" + expertOpinion;

      const completed_status_message_prompt = await replaceRuntimePlaceholders(await getAssetString("summarize-progress-start"), {
        LastOrchestratorResponse: result
      });
          
      let opinionSummary = ""
      try {
        opinionSummary = (await context.multiAgentGeminiClient.sendOneShotMessage(
          completed_status_message_prompt,
          { model: DEFAULT_GEMINI_LITE_MODEL, signal: context.signal }
        ))?.text || "";
      } catch (_error) {}

      context.sendMessage(JSON.stringify({
        status: "PROGRESS_UPDATES",
        completed_status_message: opinionSummary,
      }));
  
      addFAQ(problemSummary, expertOpinion, context);

      return {result: result};
    } catch (error) {
        const errReult = `An error occurred while asking an expert: ${error}`;
        updateLog(errReult);
        return { result: errReult };
    }
  },

  /**
   * Extract parameters from the tool invocation string.
   * @param invocation The string used to invoke the tool.
   * @returns The parameter names and corresponding values.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    if (invocation.trim()) {
      const question = invocation.trim();
      return {
        success: true, 
        params: {
          question
        }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax for ${this.displayName} Tool. No question was provided.`
      }
    }
  }
};

/**
 * Helper function to determine MIME type from filename extension for supported image types.
 */
function getImageMimeType(filename: string): string | null {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'heic': return 'image/heic';
        case 'heif': return 'image/heif';
        default: return null;
    }
}