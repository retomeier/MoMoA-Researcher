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
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
} from "./models.js";
import {
  AuthType,
  ContentGeneratorConfig,
  createContentGeneratorConfig,
} from "../services/contentGenerator.js";
import { GeminiClient } from "../services/geminiClient.js";
import { LlmClient } from "../services/llmClient.js";
import { ApiPolicyManager } from "../services/apiPolicyManager.js";
import { InfrastructureContext } from "../momoa_core/types.js";
import { getAssetString } from "../services/promptManager.js";
import { getToolNames } from "../tools/multiAgentToolRegistry.js";

export type FlashFallbackHandler = (
  currentModel: string,
  fallbackModel: string
) => Promise<boolean>;

export interface ConfigParameters {
  sessionId: string;
  embeddingModel?: string;
  debugMode: boolean;
  question?: string;
  fullContext?: boolean;
  contextFileName?: string | string[];
  fileFiltering?: {
    respectGitIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
  };
  cwd: string;
  model: string;
  maxTurns?: number; // Added maxTurns
  assumptions?: string; // Added assumptions
}

export class Config implements InfrastructureContext {
  private readonly sessionId: string;
  private contentGeneratorConfig!: ContentGeneratorConfig;
  private readonly embeddingModel: string;
  private readonly debugMode: boolean;
  private readonly question: string | undefined;
  private readonly fullContext: boolean;
  private readonly coreTools: string[] | undefined;
  private readonly excludeTools: string[] | undefined;
  private llmClient!: LlmClient;
  private readonly model: string;
  private readonly maxTurns?: number; // Initialized from params.maxTurns
  private readonly assumptions?: string; // Initialized from params.assumptions
  private modelSwitchedDuringSession: boolean = false;
  flashFallbackHandler?: FlashFallbackHandler;
  apiKey = '';
  context: InfrastructureContext = this;

  constructor(params: ConfigParameters) {
    this.sessionId = params.sessionId;
    this.embeddingModel =
      params.embeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.debugMode = params.debugMode;
    this.question = params.question;
    this.fullContext = params.fullContext ?? false;
    this.model = params.model;
    this.maxTurns = params.maxTurns; // Initialize maxTurns from params
    this.assumptions = params.assumptions; // Initialize assumptions from params
  }

  async refreshAuth(authMethod: AuthType, options?: Record<string, string>) {
    this.contentGeneratorConfig = await createContentGeneratorConfig(
      this.model,
      authMethod,
      options
    );
    this.apiKey = this.contentGeneratorConfig.apiKey || '';

    const apiPolicyManager = new ApiPolicyManager();
    this.llmClient = new GeminiClient(this, apiPolicyManager);

    // Reset the session flag since we're explicitly changing auth and using default model
    this.modelSwitchedDuringSession = false;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getContentGeneratorConfig(): ContentGeneratorConfig {
    return this.contentGeneratorConfig;
  }

  getModel(): string {
    return this.contentGeneratorConfig?.model || this.model;
  }

  setModel(newModel: string): void {
    if (this.contentGeneratorConfig) {
      this.contentGeneratorConfig.model = newModel;
      this.modelSwitchedDuringSession = true;
    }
  }

  isModelSwitchedDuringSession(): boolean {
    return this.modelSwitchedDuringSession;
  }

  resetModelToDefault(): void {
    if (this.contentGeneratorConfig) {
      this.contentGeneratorConfig.model = this.model; // Reset to the original default model
      this.modelSwitchedDuringSession = false;
    }
  }

  setFlashFallbackHandler(handler: FlashFallbackHandler): void {
    this.flashFallbackHandler = handler;
  }

  getEmbeddingModel(): string {
    return this.embeddingModel;
  }

  getDebugMode(): boolean {
    return this.debugMode;
  }
  getQuestion(): string | undefined {
    return this.question;
  }

  getFullContext(): boolean {
    return this.fullContext;
  }

  getCoreTools(): string[] | undefined {
    return this.coreTools;
  }

  getExcludeTools(): string[] | undefined {
    return this.excludeTools;
  }

  async getLlmClient(): Promise<LlmClient> {
    return this.llmClient;
  }

  async getGeminiClient(): Promise<LlmClient> {
    return this.getLlmClient();
  }

  getMaxTurns(): number | undefined {
    return this.maxTurns;
  }

  getAssumptions(): string | undefined {
    return this.assumptions;
  }
  
  // Implementation of InfrastructureContext
  getToolNames(): string[] {
    const registryTools = getToolNames();
    const configuredTools = this.coreTools || [];
    return Array.from(new Set([...configuredTools, ...registryTools]));
  }

  async getToolResultPrefix(): Promise<string> {
    return getAssetString("tool-result-prefix");
  }

  async getToolResultSuffix(): Promise<string> {
    return getAssetString("tool-result-suffix");
  }

  async getAssetString(name: string): Promise<string> {
    return getAssetString(name);
  }
}

export {
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL as DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
};

// universal session config and secret
export const CONFIG_KEY_REPO_URL = "repoUrl";
export const SECRET_KEY_GITHUB_TOKEN = "githubToken";

// Reserved file names
export const logFilename = 'RESEARCH_LOG.md';

export const MAX_MEM_PERCENTAGE = 0.85;

export const MAX_SCRIPT_EXECUTION_TIMEOUT = 15 * 60 * 1000;
