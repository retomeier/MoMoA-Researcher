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

import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../momoa_core/types.js";

export interface MultiAgentTool {
  /**
   * The display name of the tool.
   */
  readonly displayName: string;
  /**
   * The unique name of the tool, used for identification and invocation by the LLM (without the tool prefix).
   */
  readonly name: string;

  /**
   * The unique token (if any) that signifies the end of the tool's syntax.
   */
  readonly endToken?: string;

  /**
   * Executes the tool's functionality with the given parameters and ToolContext.
   * @param params A record of parameters passed to the tool, where keys are parameter names and values are their corresponding arguments.
   * @param context The ToolContext object containing necessary runtime information.
   * @returns A promise that resolves to an object containing the tool's output string and optional actions.
   */
  execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult>;

  extractParameters(invocation: string, context: MultiAgentToolContext): Promise<ToolParsingResult>;
}
