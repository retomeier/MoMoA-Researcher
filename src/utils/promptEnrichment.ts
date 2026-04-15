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

import { Part } from "@google/genai";
import { DEFAULT_GEMINI_PRO_MODEL } from "../config/models.js";
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
export async function enrichPrompt(
  enrichmentString: string,
  OriginalPrompt: string,
  Assumptions: string,
  spec: string,
  multiAgentGeminiClient: GeminiClient,
  _sendMessage: { (message: string): void },
  image?: string,
  imageMimeType?: string
): Promise<string> {
  try {
    const parts: Part[] = [];

    const enrichPromptPrompt = await replaceRuntimePlaceholders(await getAssetString(enrichmentString), {
      OriginalPrompt,
      Assumptions: Assumptions.trim(),
      Spec: spec
    });

    if (imageMimeType && image) {
      parts.push({
        inlineData: {
          mimeType: imageMimeType, 
          data: image,
        }
      });
    }
    parts.push({ text: enrichPromptPrompt });

    const result = removeBacktickFences((await multiAgentGeminiClient.sendOneShotMessage(parts,
      { 
        model: DEFAULT_GEMINI_PRO_MODEL
      }))?.text || OriginalPrompt);
    return result;
  } catch (error) {
    console.error("Enrichment Error", error);
    return OriginalPrompt;
  }
}