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

import { randomUUID } from 'crypto';
import { InfrastructureContext } from '../../../src/momoa_core/types';

/**
 * Client-side implementation of InfrastructureContext.
 * Since the client cannot access the file system, this provides hardcoded
 * placeholder values for asset strings required by shared components like
 * TranscriptManager and GeminiClient.
 */
export class ClientInfrastructureContext implements InfrastructureContext {
  getToolNames(): string[] {
    return [];
  }

  async getToolResultPrefix(): Promise<string> {
    return '---TOOL RESULT START---';
  }

  async getToolResultSuffix(): Promise<string> {
    return '---TOOL RESULT END---';
  }

  async getAssetString(name: string): Promise<string> {
    switch (name) {
      case 'response-stop-strings':
        // Common stop words used by the server components.
        return '\nSTOP_SEQUENCE\n<FINISH_RESPONSE>\n';
      case 'tool-prefix':
        // Prefix used to identify tool calls in LLM responses.
        return 'TOOL_CALL:';
      default:
        return '';
    }
  }

  getSessionId(): string {
    return randomUUID().toString();
  }
}
