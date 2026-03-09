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

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
  Model,
  GetModelParameters,
} from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "../config/models.js";

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  get(params: GetModelParameters): Promise<Model>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = "oauth-personal",
  USE_GEMINI = "gemini-api-key",
  USE_VERTEX_AI = "vertex-ai",
  CLOUD_SHELL = "cloud-shell",
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
  options?: Record<string, string>
): Promise<ContentGeneratorConfig> {
  const geminiApiKey = options?.geminiApiKey || process.env.GEMINI_API_KEY;
  const googleApiKey = options?.googleApiKey || process.env.GOOGLE_API_KEY;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION;

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = model || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    !!googleApiKey &&
    googleCloudProject &&
    googleCloudLocation
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  sdkVersion?: string,
  platformDetails?: string
): Promise<ContentGenerator> {
  let httpOptions: { headers: { "User-Agent": string } } | undefined = undefined;

  if (sdkVersion && platformDetails) {
    httpOptions = {
      headers: {
        "User-Agent": `GeminiCLI/${sdkVersion} (${platformDetails})`,
      },
    };
  }
  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    throw new Error(
      `Error creating contentGenerator: Unsupported Content Generator Type (Code Assist)`
    );
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === "" ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });
    return googleGenAI.models;
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`
  );
}

/**
 * Resolves the API Key for a specific model based on environment variables.
 * Naming Convention: GEMINI_API_KEY_{MODEL_NAME_SANITIZED}
 * Example: gemini-1.5-pro -> GEMINI_API_KEY_GEMINI_1_5_PRO
 * Fallback: Returns defaultApiKey if no specific env var is found.
 */
export function resolveApiKeyForModel(model: string, defaultApiKey?: string): string | undefined {
  if (!model) return defaultApiKey;
  
  // Sanitize: Uppercase and replace non-alphanumeric chars with '_'
  const sanitizedModel = model.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envVarName = `GEMINI_API_KEY_${sanitizedModel}`;
  
  return process.env[envVarName] || defaultApiKey;
}
