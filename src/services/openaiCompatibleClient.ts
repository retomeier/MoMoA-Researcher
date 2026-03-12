import {
  BlockedReason,
  FinishReason,
  GenerateContentResponse,
  Part,
} from "@google/genai";
import { DEFAULT_GEMINI_FLASH_MODEL, resolveModelForProvider } from "../config/models.js";
import {
  FormattedTranscriptEntry,
  FormattedTranscriptPart,
} from "../momoa_core/types.js";
import { LlmBlockedError } from "../shared/errors.js";
import {
  LlmClient,
  LlmGenerateOptions,
  LlmPromptPart,
  TokenUsageStats,
} from "./llmClient.js";
import { TranscriptManager } from "./transcriptManager.js";

type OpenAICompatibleClientConfig = {
  apiKey: string;
  baseURL: string;
  model?: string;
};

type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<Record<string, unknown>>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    index: number;
    finish_reason: string | null;
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

export class OpenAICompatibleClient implements LlmClient {
  private readonly config: OpenAICompatibleClientConfig;
  private tokenUsage = new Map<string, TokenUsageStats>();

  constructor(config: OpenAICompatibleClientConfig) {
    this.config = config;
  }

  public getTokenUsage(): Map<string, TokenUsageStats> {
    return this.tokenUsage;
  }

  public async trimToTokenLimit(
    _model: string,
    data: string,
    _proportionOfLimit: number
  ): Promise<string> {
    return data;
  }

  public async sendOneShotMessage(
    prompt: string | LlmPromptPart[],
    options?: LlmGenerateOptions
  ): Promise<GenerateContentResponse> {
    const userMessage = this.mapPromptToMessage(prompt);
    return this.request([userMessage], options);
  }

  public async sendTranscriptMessage(
    transcriptManager: TranscriptManager | undefined,
    options?: LlmGenerateOptions
  ): Promise<GenerateContentResponse> {
    const transcript = transcriptManager?.getTranscript() ?? [];
    const messages = this.mapTranscriptToMessages(transcript);
    const response = await this.request(messages, options);

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      const hasFunctionCalls = modelContent.parts?.some((part) => !!part.functionCall);

      if (hasFunctionCalls) {
        transcriptManager?.addEntry(modelContent.role ?? "model", modelContent.parts as any, {}, false);
      } else {
        const responseText =
          modelContent.parts
            ?.map((part) => ("text" in part ? part.text : ""))
            .join("\n")
            .trim() || response.text || "";

        const cleanTranscriptEntry =
          (await transcriptManager?.cleanLLMResponse(responseText)) || responseText;

        transcriptManager?.addEntry(modelContent.role ?? "model", cleanTranscriptEntry, {}, false);

        if (response.candidates?.[0]?.content) {
          response.candidates[0].content.parts = [{ text: cleanTranscriptEntry }];
          (response as any).text = cleanTranscriptEntry;
        }
      }
    }

    return response;
  }

  private mapPromptToMessage(prompt: string | LlmPromptPart[]): OpenAIMessage {
    if (typeof prompt === "string") {
      return {
        role: "user",
        content: prompt,
      };
    }

    return {
      role: "user",
      content: this.mapPartsToContent(prompt),
    };
  }

  private mapTranscriptToMessages(transcript: FormattedTranscriptEntry[]): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [];
    const pendingToolCalls = new Map<string, string[]>();

    for (const entry of transcript) {
      const role = entry.role === "model" ? "assistant" : entry.role === "user" ? "user" : "user";

      const toolCalls = entry.parts
        .filter((part) => !!part.functionCall)
        .map((part, index) => {
          const name = part.functionCall?.name || `tool_${index}`;
          const id = `tool_call_${messages.length}_${index}_${name}`;
          const existing = pendingToolCalls.get(name) || [];
          existing.push(id);
          pendingToolCalls.set(name, existing);
          return {
            id,
            type: "function" as const,
            function: {
              name,
              arguments: JSON.stringify(part.functionCall?.args || {}),
            },
          };
        });

      const textAndImages = entry.parts.filter(
        (part) => part.text || part.inlineData
      ) as LlmPromptPart[];

      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          tool_calls: toolCalls,
          content:
            textAndImages.length > 0 ? this.mapPartsToContent(textAndImages) : "",
        });
      } else if (entry.parts.some((part) => !!part.functionResponse)) {
        for (const part of entry.parts) {
          if (!part.functionResponse) continue;

          const toolName = part.functionResponse.name || "tool";
          const queue = pendingToolCalls.get(toolName) || [];
          const toolCallId = queue.shift() || `tool_call_${messages.length}_${toolName}`;
          pendingToolCalls.set(toolName, queue);

          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            name: toolName,
            content: this.stringifyToolResponse(part.functionResponse.response),
          });
        }
      } else {
        messages.push({
          role,
          content: this.mapPartsToContent(entry.parts),
        });
      }
    }

    return messages;
  }

  private mapPartsToContent(parts: Array<LlmPromptPart | FormattedTranscriptPart>): Array<Record<string, unknown>> {
    return parts.flatMap((part) => {
      const contentParts: Array<Record<string, unknown>> = [];

      if (part.text) {
        contentParts.push({
          type: "text",
          text: part.text,
        });
      }

      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || "application/octet-stream";
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${part.inlineData.data}`,
          },
        });
      }

      return contentParts;
    });
  }

  private stringifyToolResponse(response: unknown): string {
    if (typeof response === "string") {
      return response;
    }
    return JSON.stringify(response ?? {});
  }

  private mapFinishReason(reason: string | null | undefined): FinishReason | undefined {
    if (reason === "tool_calls") return FinishReason.STOP;
    if (reason === "stop") return FinishReason.STOP;
    if (reason === "length") return FinishReason.MAX_TOKENS;
    if (reason === "content_filter") return FinishReason.SAFETY;
    return FinishReason.FINISH_REASON_UNSPECIFIED;
  }

  private createErrorResponse(message: string): GenerateContentResponse {
    return {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: `--- The OpenAI-compatible API was unable to provide a response (${message}) ---` }],
          },
          finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
          index: 0,
          safetyRatings: [],
        },
      ],
      promptFeedback: {
        blockReason: BlockedReason.BLOCKED_REASON_UNSPECIFIED,
        safetyRatings: [],
      },
      text: `--- The OpenAI-compatible API was unable to provide a response (${message}) ---`,
      data: "",
      functionCalls: [],
      executableCode: "",
      codeExecutionResult: "",
    };
  }

  private async request(
    messages: OpenAIMessage[],
    options?: LlmGenerateOptions
  ): Promise<GenerateContentResponse> {
    const model = resolveModelForProvider(
      options?.model || this.config.model || DEFAULT_GEMINI_FLASH_MODEL
    );
    const url = `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature,
      stream: false,
    };

    if (options?.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      const json = (await response.json()) as OpenAIChatCompletionResponse;

      if (!response.ok) {
        const message = json.error?.message || `HTTP ${response.status}`;
        if (response.status === 429) {
          throw new Error(message);
        }
        return this.createErrorResponse(message);
      }

      const choice = json.choices?.[0];
      const content = choice?.message?.content || "";
      const toolCalls = choice?.message?.tool_calls || [];

      const parts: Part[] = [];
      if (content) {
        parts.push({ text: content });
      }

      for (const toolCall of toolCalls) {
        parts.push({
          functionCall: {
            name: toolCall.function?.name,
            args: this.safeParseArgs(toolCall.function?.arguments),
          },
        } as Part);
      }

      const result: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts,
            },
            finishReason: this.mapFinishReason(choice?.finish_reason),
            index: choice?.index ?? 0,
            safetyRatings: [],
          },
        ],
        promptFeedback: {
          blockReason: BlockedReason.BLOCKED_REASON_UNSPECIFIED,
          safetyRatings: [],
        },
        text: content,
        data: "",
        functionCalls: toolCalls.map((toolCall) => ({
          name: toolCall.function?.name,
          args: this.safeParseArgs(toolCall.function?.arguments),
        })) as any,
        executableCode: "",
        codeExecutionResult: "",
        usageMetadata: {
          promptTokenCount: json.usage?.prompt_tokens,
          candidatesTokenCount: json.usage?.completion_tokens,
          totalTokenCount:
            (json.usage?.prompt_tokens || 0) + (json.usage?.completion_tokens || 0),
        } as any,
      };

      this.tokenUsage.set(model, {
        inputTokens:
          (this.tokenUsage.get(model)?.inputTokens || 0) +
          (json.usage?.prompt_tokens || 0),
        outputTokens:
          (this.tokenUsage.get(model)?.outputTokens || 0) +
          (json.usage?.completion_tokens || 0),
        cachedInputTokens: this.tokenUsage.get(model)?.cachedInputTokens || 0,
      });

      return result;
    } catch (error) {
      if (error instanceof LlmBlockedError) {
        throw error;
      }
      return this.createErrorResponse(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private safeParseArgs(rawArgs: string | undefined): Record<string, unknown> {
    if (!rawArgs) return {};
    try {
      return JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return { raw: rawArgs };
    }
  }
}
