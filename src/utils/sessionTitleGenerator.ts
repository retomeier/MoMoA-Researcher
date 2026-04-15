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

export async function generateSessionTitle(
  userPrompt: string,
  geminiClient: GeminiClient
): Promise<string> {
  let prompt = `
Please provide a concise and descriptive title for the following programming task or project prompt. The title should be brief, ideally under 10 words, and should capture the essence of the task. Do not use
any formatting, or punctuation surrounding the title, avoiding quotation marks, asterisks, etc.

User prompt: ${userPrompt}
`;

  let sessionTitle =
    (
      await geminiClient.sendOneShotMessage(prompt, {
        model: DEFAULT_GEMINI_LITE_MODEL,
      })
    )?.text?.trim() || "";
  return sessionTitle;
}
