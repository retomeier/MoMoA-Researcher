import { GenerateContentResponse } from "@google/genai";
import { TranscriptManager } from "./transcriptManager.js";

export type LlmPromptPart = {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    role?: string;
    name?: string;
    response?: unknown;
    filename?: string;
  };
};

export type LlmToolProperty = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  items?: {
    type: "string" | "number" | "integer" | "boolean" | "object";
  };
  properties?: Record<string, LlmToolProperty>;
  required?: string[];
};

export type LlmToolFunctionDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, LlmToolProperty>;
    required: string[];
  };
};

export type LlmGenerateOptions = {
  model?: string;
  temperature?: number;
  enableThinking?: boolean;
  enableGrounding?: boolean;
  signal?: AbortSignal;
  responseMimeType?: string;
  tools?: LlmToolFunctionDeclaration[];
};

export type TokenUsageStats = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export interface LlmClient {
  getTokenUsage(): Map<string, TokenUsageStats>;
  trimToTokenLimit(
    model: string,
    data: string,
    proportionOfLimit: number
  ): Promise<string>;
  sendOneShotMessage(
    prompt: string | LlmPromptPart[],
    options?: LlmGenerateOptions
  ): Promise<GenerateContentResponse>;
  sendTranscriptMessage(
    transcriptManager: TranscriptManager | undefined,
    options?: LlmGenerateOptions
  ): Promise<GenerateContentResponse>;
}
