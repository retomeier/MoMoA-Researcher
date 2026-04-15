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

import { DEFAULT_GEMINI_FLASH_MODEL, DEFAULT_GEMINI_LITE_MODEL } from "../../config/models.js";
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { getToolPreamblePrompt, replaceRuntimePlaceholders } from "../../services/promptManager.js";
import { getFilesAndContent, removeBacktickFences, repairTruncatedJsonArray } from "../../utils/markdownUtils.js";
import { MultiAgentTool } from "../multiAgentTool.js";
import { generateDiff } from '../../utils/diffGenerator.js';

export const paradoxResolutionTool: MultiAgentTool = {
  displayName: "Paradox Resolution",
  name: 'PARADOX',

/**
 * Executes the Paradox Resolution tool.
 * @param params The parameters for the tool's execution, expecting a 'query' property.
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

  context.sendMessage(JSON.stringify(
    {
      type: 'PROGRESS_UPDATE',
      message: `I've encountered a Paradox, so I'm asking an 'Expert' persona to help me resolve it.`,
    }
  ));
      
  try {      
    let paradoxToSolve = question;
    let requestedFiles = [];
    let fileNamesPlusContentString = 'No files were provided.';

    const relevantFilesMarker = 'RELEVANT_FILES:';
    const fileMarkerIndex = question.indexOf(relevantFilesMarker);

    if (fileMarkerIndex > -1) {
      paradoxToSolve = question.substring(0, fileMarkerIndex).trim();
      const filesJsonString = question.substring(fileMarkerIndex + relevantFilesMarker.length).trim();

      try {
        const parsedFiles = JSON.parse(repairTruncatedJsonArray(filesJsonString) ?? filesJsonString);
        if (Array.isArray(parsedFiles)) {
          requestedFiles = parsedFiles;
        } else {
          updateLog('RELEVANT_FILES section is not a JSON array');
        }
      } catch (jsonError) {
        updateLog(`Failed to parse RELEVANT_FILES JSON: ${jsonError}`);
        updateLog(`Problematic JSON string: ${filesJsonString}`);
      }
    } else {
      updateLog(`RELEVANT_FILES marker not found in question.`);
    }

    fileNamesPlusContentString = await getFilesAndContent(requestedFiles, context);

    // Generate the unified diff
    const diffBlock = generateDiff(
      context.originalFileMap,
      context.fileMap,
      context.editedFilesSet,
      new Set(context.originalBinaryFileMap.keys())
    );
    const projectDiffString = diffBlock ? `${diffBlock}` : "--No changes detected---";

    let paradoxPrompt = await getToolPreamblePrompt('paradox-preamble');
    let createContradictionPrompt = await getToolPreamblePrompt('create-contradiction-preamble');

    createContradictionPrompt = await replaceRuntimePlaceholders(
      createContradictionPrompt, 
      { ContradictThis: paradoxToSolve });

    let contradiction = (await context.multiAgentGeminiClient.sendOneShotMessage(
      createContradictionPrompt,
      { model: DEFAULT_GEMINI_FLASH_MODEL }))?.text?.trim() || '';
    contradiction = removeBacktickFences(contradiction).trim();

    paradoxPrompt = await replaceRuntimePlaceholders(
      paradoxPrompt, 
      { 
        ParadoxToResolve: paradoxToSolve,
        Contradiction: contradiction,
        RelatedFiles: fileNamesPlusContentString,
        ProjectDiff: projectDiffString
      });

    let paradoxResolution = (await context.multiAgentGeminiClient.sendOneShotMessage(
      paradoxPrompt,
      { 
        model: DEFAULT_GEMINI_FLASH_MODEL,
        enableThinking: true
      }))?.text?.trim() || '';
      paradoxResolution = removeBacktickFences(paradoxResolution).trim();

    if (!paradoxResolution) {
      const nullResult = '[The expert provided a non-text response]';
      updateLog(nullResult);
      context.sendMessage({
        type: 'PROGRESS_UPDATE',  
        message: "The Expert wasn't able to help.",
      });
      return { result: nullResult };
    }

    const result = `You asked for clarification and this is the result:\n${paradoxResolution}`;

    try {
      const resolutionSummaryPromise = context.multiAgentGeminiClient.sendOneShotMessage(
        result,
        { model: DEFAULT_GEMINI_LITE_MODEL, signal: context.signal }
      ).then(msg => msg.text || "");

      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: resolutionSummaryPromise,
      });
    } catch (_error) {}

    return { result };

  } catch (error) {
    const errReult = `An error occurred while asking an expert: ${error}`;
    updateLog(errReult);
    context.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: "The Expert wasn't able to help.",
    });
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
        error: `Invalid syntax for ${this.displayName} Tool. No paradox or question was provided.`
      }
    }
  }  
};