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

import { DEFAULT_GEMINI_LITE_MODEL } from "../config/models.js";
import { GeminiClient } from "../services/geminiClient.js";
import { getAssetString, replaceRuntimePlaceholders } from "../services/promptManager.js";
import { removeBacktickFences } from "./markdownUtils.js";

/**
 * Attempts to find a filename in a map, using an LLM as a fallback to correct typos.
 *
 * @param filename The name of the file to look up.
 * @param fileContentMap A map of existing filenames to their content.
 * @returns The corrected filename if found, otherwise the original (trimmed) filename.
 */
export async function fileNameLookup(
  filename: string | undefined,
  fileContentMap: Map<string, string>,
  multiAgentGeminiClient: GeminiClient,
): Promise<string> {
  // Use optional chaining and the nullish coalescing operator for a concise initial check.
  const trimmedFilename = filename?.trim() ?? "";

  if (!trimmedFilename || fileContentMap.has(trimmedFilename)) {
    return trimmedFilename;
  }

  try {
    const allNames = Array.from(fileContentMap.keys())
    .map(name => `${name}`)
    .join('\n');

    let fileNameLookupPrompt = await getAssetString('file-finder-prompt');
    fileNameLookupPrompt = await replaceRuntimePlaceholders(
      fileNameLookupPrompt, 
      {
        AvailableFile: allNames,
        RequestedFilename: trimmedFilename
      }
    );

    let llmSuggestedFileName = (await multiAgentGeminiClient.sendOneShotMessage(
      fileNameLookupPrompt,
      { model: DEFAULT_GEMINI_LITE_MODEL } 
    ))?.text?.trim() || "";

    // Clean the LLM's response.
    const suggestion = removeBacktickFences(llmSuggestedFileName)
      .replace(/[`'"{}*]/g, "")
      .trim();

    // Check if the LLM returned a usable response.
    if (!suggestion) {
      return trimmedFilename;
    }

    // If the suggested filename exists in the map, use it.
    if (fileContentMap.has(suggestion)) {
      return suggestion;
    }

    return trimmedFilename;
    
  } catch (error) {
    return trimmedFilename;
  }
}