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
import { 
    MultiAgentToolContext, 
    MultiAgentToolResult, 
    ToolParsingResult } from '../../momoa_core/types.js';
import { getToolPreamblePrompt, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { julesTool } from './julesTool.js';

export const screenCaptureTool: MultiAgentTool = {
  displayName: "Screenshot Tool",
  name: 'SCREENSHOT',
  
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    let request = invocation;

    if (invocation.startsWith("{"))
     request = invocation.slice(1, -1).trim();

    if (!request) {
      return {
        success: false,
        error: `Invalid syntax for ${this.displayName}. A natural language request must be provided.`
      };
    }
    
    return {
      success: true,
      params: { request }
    };
  },

  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const userRequest = params.request;

    const screenshotRequest = await replaceRuntimePlaceholders(
      await getToolPreamblePrompt("screen-capture-tool-preamble"),{
        UserRequest: userRequest
      });

    const jules_params = {
      request: screenshotRequest,
    }

    return await julesTool.execute(jules_params, context);
  }
}