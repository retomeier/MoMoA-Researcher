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
  GenerateContentResponse,
  Content,
  GenerateContentConfig,
  Part,
  FinishReason,
  BlockedReason,
  Tool,
  Type,
} from '@google/genai';
import { ApiPolicyManager } from './apiPolicyManager.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { TranscriptManager } from './transcriptManager.js';
import { ContentGenerator, createContentGenerator, ContentGeneratorConfig, AuthType, resolveApiKeyForModel } from './contentGenerator.js';
import { FormattedTranscriptEntry, GeminiClientConfig, MarkerPair, ToolFunctionDeclaration } from '../momoa_core/types.js';
import { LlmBlockedError } from '../shared/errors.js';

const MAX_ATTEMPTS = 6;

/**
 * Interface for options passed to content generation methods.
 */
export interface GenerateContentOptions {
  model?: string;
  temperature?: number;
  enableThinking?: boolean;
  enableGrounding?: boolean;
  signal?: AbortSignal; 
  responseMimeType?: string;
  tools?: ToolFunctionDeclaration[]; 
}

/**
 * Client for interacting with the Gemini API in a multi-agent context.
 * Manages API calls, applies policy (rate limiting, backoff),
 * and integrates with chat history and telemetry.
 */
export class GeminiClient {
  private contentGenerators = new Map<string, Promise<ContentGenerator>>();
  private readonly apiPolicyManager: ApiPolicyManager;
  private readonly config: GeminiClientConfig;
  private readonly apiName = 'Gemini';

  // We store non-cached input, cached input, and output tokens separately.
  private tokenUsage = new Map<string, { 
    inputTokens: number, 
    outputTokens: number, 
    cachedInputTokens: number 
  }>();

  constructor(config: GeminiClientConfig, apiPolicyManager: ApiPolicyManager) {
    this.apiPolicyManager = apiPolicyManager;
    this.config = config;
  }

  /**
   * Private method to retrieve or create a ContentGenerator instance for a given model.
   * The instance is keyed by the resolved API key to ensure that clients using the same key
   * (even if for different models) share the same underlying generator, and clients using
   * different keys get separate generators.
   */
  private async getContentGenerator(model: string): Promise<ContentGenerator> {
    const apiKey = resolveApiKeyForModel(model, this.config.apiKey);

    if (!apiKey) {
      throw new Error(`API Key not found for model: ${model}. Check environment variables or default configuration.`);
    }

    if (this.contentGenerators.has(apiKey)) {
      return this.contentGenerators.get(apiKey)!;
    }

    console.log(`Creating new Content Generator for API Key ${apiKey} (for ${model}).`)

    const generatorPromise = (async () => {
      try {
        const contentGeneratorConfig: ContentGeneratorConfig = {
          model: model, // Use the requested model for initial config
          authType: AuthType.USE_GEMINI,
          apiKey: apiKey,
        };
        
        const contentGenerator = await createContentGenerator(
          contentGeneratorConfig,
        );
        return contentGenerator;
      } catch (error) {
        console.error(
          `FATAL: GeminiClient failed to initialize ContentGenerator for model ${model}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Remove the failed promise from the cache to allow retries if needed
        this.contentGenerators.delete(apiKey);
        throw new Error('ContentGenerator initialization failed.');
      }
    })();

    this.contentGenerators.set(apiKey, generatorPromise);
    return generatorPromise;
  }

  /**
   * Retrieves the aggregated token usage statistics.
   * @returns A Map where the key is the model name and the value is an
   * object containing total input, output, and cached-input tokens.
   */
  public getTokenUsage(): Map<string, { 
    inputTokens: number, 
    outputTokens: number, 
    cachedInputTokens: number 
  }> {
    return this.tokenUsage;
  }

  /**
   * Updates the token usage statistics based on an API response.
   * This now correctly subtracts cached tokens from the prompt tokens.
   * @param modelName The name of the model that was used.
   * @param response The GenerateContentResponse from the API.
   */
  private updateTokenUsage(modelName: string, response: GenerateContentResponse): void {
    const usage = response.usageMetadata;
    if (usage) {
      // Get the current stats, or initialize them
      const stats = this.tokenUsage.get(modelName) || { 
        inputTokens: 0, 
        outputTokens: 0, 
        cachedInputTokens: 0 
      };
      
      // Get all token counts, defaulting to 0
      const promptTokens = usage.promptTokenCount || 0;
      const cachedTokens = usage.cachedContentTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;

      // Calculate the non-cached (billable) input tokens
      const nonCachedInputTokens = promptTokens - cachedTokens;

      // Update the totals
      stats.inputTokens += nonCachedInputTokens;
      stats.outputTokens += outputTokens;
      stats.cachedInputTokens += cachedTokens;
      
      this.tokenUsage.set(modelName, stats);
    }
  }

  /**
   * Detects and cleans repetitive output where a block of lines is repeated more than 5 times.
   * Keeps the first two iterations and replaces the rest with a placeholder.
   * Also removes a trailing line if it is a substring of the start of the block.
   */
  private _removeRepetitiveBlocks(text: string): string {
    const MAX_REPETITIONS = 10;
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
      let bestBlockSize = 0;
      let bestRepeatCount = 0;
      
      // We look for a block of size k that repeats at least 6 times (original + 5 repeats).
      // Max feasible block size is remaining_lines / 6.
      const maxBlockSize = Math.floor((lines.length - i) / 6);

      // Check for repetitions starting at i with block size k
      for (let k = 1; k <= maxBlockSize; k++) {
        let count = 1; // The block exists at least once
        let p = i + k; // Start of the next potential block

        while (p + k <= lines.length) {
          let match = true;
          // Compare current block [p ... p+k-1] with the reference block [i ... i+k-1]
          for (let j = 0; j < k; j++) {
            if (lines[i + j] !== lines[p + j]) {
              match = false;
              break;
            }
          }
          if (match) {
            count++;
            p += k;
          } else {
            break;
          }
        }

        if (count > MAX_REPETITIONS) {
          // Found a repetition > 5. Since we iterate k from 1, this finds the smallest repeating unit.
          bestBlockSize = k;
          bestRepeatCount = count;
          break; // Stop searching for larger blocks, prioritize the smallest repeating unit.
        }
      }

      if (bestBlockSize > 0) {
        // Keep the allowable iterations of the block
        for (let j = 0; j < MAX_REPETITIONS * bestBlockSize; j++) {
          cleanedLines.push(lines[i + j]);
        }

        cleanedLines.push(`[--- ${bestRepeatCount - MAX_REPETITIONS}x duplicated blocks removed---]`);

        // Advance index past all duplicates
        i += bestBlockSize * bestRepeatCount;

        if (i < lines.length) {
          const nextLine = lines[i];
          const firstLineOfBlock = lines[i - (bestBlockSize * bestRepeatCount)];
          
          if (nextLine.length > 0 && firstLineOfBlock.startsWith(nextLine)) {
            i++;
          }
        }
      } else {
        // No excessive duplication found at this line
        cleanedLines.push(lines[i]);
        i++;
      }
    }

    return cleanedLines.join('\n');
  }

  /**
   * Maps our internal FormattedTranscriptEntry[] structure to the Gemini SDK's Content[] structure.
   * This is necessary because the SDK's Part type is structurally compatible with 
   * FormattedTranscriptPart, but TypeScript requires explicit mapping or casting 
   * due to different import sources.
   */
  private _mapFormattedTranscriptToContent(
    transcript: FormattedTranscriptEntry[]
  ): Content[] {
    return transcript.map(entry => ({
      role: entry.role,
      // We assume FormattedTranscriptPart is structurally identical to the SDK's Part type.
      // We must cast here to satisfy the Content type definition.
      parts: entry.parts as Part[],
    }));
  }

  private _createErrorResponse(
    errorMessage: string,
  ): GenerateContentResponse {
    console.error(`GeminiClient returning error response: ${errorMessage}`);
    const errorText = `--- The Gemini API was unable to provide a response (${errorMessage}) ---`;
    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: errorText,
              },
            ],
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
      text: errorText,
      data: '',
      functionCalls: [],
      executableCode: '',
      codeExecutionResult: '',
    };
  }

  /**
   * Tries to parse an API error message (which might be a JSON string)
   * to find a 'retryDelay' field from a Google RPC QuotaFailure.
   * @param errorMessage The error message string, which may be JSON.
   * @returns The suggested delay in milliseconds, or null if not found.
   */
  private _parseRetryDelayFromString(errorMessage: string): number | null {
    try {
      // The error message is a JSON string, so we parse it.
      const errorObj = JSON.parse(errorMessage);
      const details = errorObj?.error?.details;

      if (!Array.isArray(details)) {
        return null;
      }

      // Find the retry info object in the details array
      const retryInfo = details.find(
        (d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
      );

      const delayStr = retryInfo?.retryDelay;
      if (typeof delayStr !== 'string') {
        return null;
      }

      // Parse strings like "15s" or "12.5s"
      const match = delayStr.match(/^(\d+(\.\d+)?)(s|ms)?$/);
      if (!match) {
        console.warn(`Could not parse retryDelay string: ${delayStr}`);
        return null;
      }

      const value = parseFloat(match[1]);
      const unit = match[3];

      if (unit === 'ms') {
        return value;
      }
      
      // Default to seconds (e.g., "15s" or just "15")
      return value * 1000;

    } catch (parseError) {
      // This error was not the JSON we were expecting.
      // This is fine, it's just not a 429 quota error.
      return null;
    }
  }

  /**
   * Replaces the content between the *first* pair of ordered 'start' and 'end'
   * markers it finds in the contents array with "---REMOVED---".
   * It prioritizes replacement based on the order of the provided marker pairs.
   * This is done non-destructively by returning a new array.
   * * @param contents The array of Content objects.
   * @param orderedMarkerPairs An array of MarkerPair objects defining the order
   * of markers to search for and replace.
   * @returns A new, modified array of Content objects.
   */
  private async _reduceContents(
      contents: Content[],
      orderedMarkerPairs: MarkerPair[]
  ): Promise<Content[]> {
      let replacedOne = false;

      // Use a standard replacement text
      const replacementText = '---TOOL RESPONSE REMOVED---';

      // 1. Iterate through the ordered marker pairs
      for (const markerPair of orderedMarkerPairs) {
        const { begin: toolBeginMarker, end: toolEndMarker } = markerPair;
        
        // Reset state for a clean pass for this marker pair
        const intermediateContents: Content[] = [];
        replacedOne = false;

        // 2. Iterate through the contents array to find the *first* match for the current marker pair
        for (const content of contents) {
          // Optimization: If a replacement was already made for this marker pair, just copy the rest
          if (replacedOne) {
            intermediateContents.push(content);
            continue;
          }

          const newParts: Part[] = [];
          let partReplaced = false;

          if (content.parts) {
            for (const part of content.parts) {
              if ('text' in part && !partReplaced) {
                const text = part.text;
                if (text) {
                  const startIndex = text.indexOf(toolBeginMarker);

                  if (startIndex !== -1) {
                    // Found the begin marker, now look for the end marker *after* it
                    const endIndex = text.indexOf(toolEndMarker, startIndex + toolBeginMarker.length);

                    if (endIndex !== -1) {
                      // Found a complete block!
                      const pre = text.substring(0, startIndex);
                      const post = text.substring(endIndex + toolEndMarker.length);

                      // Create the new part with the replacement text
                      newParts.push({ text: pre + replacementText + post });
                      
                      // Mark that the overall reduction is complete for this call
                      replacedOne = true; 
                      partReplaced = true;
                      continue; // Move to the next part/content
                    }
                  }
                }
              }
              // If no replacement was made in this part, or not a text part, push the original part
              newParts.push(part);
            }
          }

          // Push the modified/unmodified content object to the intermediate array
          intermediateContents.push({ ...content, parts: newParts });
        }
        
        // 3. Check if a replacement was made using this specific marker pair
        if (replacedOne) {
          // A replacement was made (using the current markerPair).
          // The logic dictates we only remove ONE block per function call,
          // so we return the result immediately.
          return intermediateContents;
        }
        
        // If no replacement was made, continue to the next marker pair.
      }

      if (!replacedOne) {
        
        const indexToRemove = 3; // The fourth element is at index 3.
        
        if (contents.length <= indexToRemove) {
            // Cannot remove the 4th element if there are 3 or fewer elements.
            console.warn(`Cannot perform secondary reduction: Contents array length is only ${contents.length}. Must have at least ${indexToRemove + 1} elements.`);
            return contents;
        }

        // Create a non-destructive copy of the array.
        const reducedContents = [...contents]; 
        
        // Use splice() on the copy to remove 1 element starting at the specified index.
        reducedContents.splice(indexToRemove, 1);
        
        console.warn(`Performed secondary reduction: Removed the single content block at index ${indexToRemove} (the 4th element).`);
        return reducedContents;
    }

      // 4. Fallback if no reduction was possible across all marker pairs
      console.warn('Could not reduce contents further: No replaceable tool blocks found for any defined marker pairs.');
      return contents;
  }

  public async trimToTokenLimit(
    model: string,
    data: string,
    proportionOfLimit: number
  ): Promise<string> {
   
    // 1. Get the generator and model limits
    const contentGenerator = await this.getContentGenerator(model);
    const modelInfo = await contentGenerator.get({ model });
    const contextWindowSize = modelInfo?.inputTokenLimit ?? 1_048_576; // Default to 1M if undefined
    const maxTokens = Math.floor(contextWindowSize * proportionOfLimit);

    // 2. Count tokens in the specific data string
    const { totalTokens } = await contentGenerator.countTokens({
      model,
      contents: [{ role: 'user', parts: [{ text: data }] }]
    });

    // 3. Check and Trim if strictly necessary
    if (totalTokens && totalTokens > maxTokens) {
      console.warn(`Data exceeds context window (${totalTokens} > ${contextWindowSize}). Trimming to 90% (~${maxTokens} tokens).`);

      // Calculate ratio to slice string (Character approximation based on token overage)
      const ratio = maxTokens / totalTokens;
      const newLength = Math.floor(data.length * ratio);

      data = data.substring(0, newLength) + '\n...[TRIMMED DUE TO CONTEXT LIMIT]...';
    }

    return data;
  }

  /**
   * Private method to handle API calls with retry, exponential backoff,
   * and context size management.
   */
  private async _generateContentWithRetries(
    model: string,
    contents: Content[],
    generateConfig: GenerateContentConfig,
    signal?: AbortSignal,
  ): Promise<GenerateContentResponse> {
    let contentGenerator: ContentGenerator;
    try {
      contentGenerator = await this.getContentGenerator(model);
    } catch (e) {
      return this._createErrorResponse(
        `GeminiClient failed to initialize ContentGenerator for model ${model}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    let currentContents = [...contents];

    // --- Proactive Context Size Management ---
    try {
      const modelInfo = await contentGenerator.get({model: model})
      const maxTokens = modelInfo?.inputTokenLimit;

      if (maxTokens) {
        const toolBeginMarker = await this.config.context.getToolResultPrefix();
        const toolEndMarker = await this.config.context.getToolResultSuffix();

        const markers = [
          { begin: toolBeginMarker, end: toolEndMarker }, // Pair 1 (Highest priority)
          { begin: "@DOC/EDIT{", end: "END_EDIT" }, // Pair 2
        ];


        const limit = maxTokens * 0.99; // Be conservative
        
        let countRequest: any = { model: model, contents: currentContents };
        let tokenCheck = await contentGenerator.countTokens(countRequest);
        let currentTokens = tokenCheck.totalTokens;

        while (currentTokens && currentTokens > limit) {
          console.warn(`Proactively reducing context size. Current: ${currentTokens}, Limit: ${Math.floor(limit)}`);
          
          currentContents = await this._reduceContents(currentContents, markers);
          
          countRequest = { model: model, contents: currentContents };
          tokenCheck = await contentGenerator.countTokens(countRequest);
          let newTokens = tokenCheck.totalTokens;

          if (newTokens === currentTokens) {
            // No reduction happened, or reduction didn't save tokens.
            console.error('Failed to reduce context size. No replaceable blocks found or reduction was ineffective. Aborting Task.');
            throw new Error('Context reduction failed: Cannot proceed with content generation.');
          }
          currentTokens = newTokens;
        }
      }
    } catch (error) {
      console.error('Error during proactive token count:', error);
      // Proceed anyway and let the reactive check handle it
    }
    // --- End Proactive Check ---

    try {
      await this.apiPolicyManager.trackAndApplyPolicy(this.apiName, model);
    } catch (error) {
      if (error instanceof LlmBlockedError) {
        throw error;
      }
      
      return this._createErrorResponse(
        `ApiPolicyManager check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Abort handling for each attempt
        if (signal?.aborted) {
          throw new DOMException('Request aborted before sending.', 'AbortError');
        }

        const apiCallPromise = contentGenerator.generateContent({
          model,
          contents: currentContents,
          config: generateConfig,
        } as any);

        let response: GenerateContentResponse;

        if (signal) {
          let abortHandler: () => void;
          
          const abortPromise = new Promise<never>((_, reject) => {
            abortHandler = () =>
              reject(new DOMException('Request aborted by user.', 'AbortError'));
            signal.addEventListener('abort', abortHandler, { once: true });
          });

          try {
            response = await Promise.race([apiCallPromise, abortPromise]);
          } finally {
            signal.removeEventListener('abort', abortHandler!);
          }
        } else {
          response = await apiCallPromise;
        }

        // A successful response must have candidates. If not, treat as a failure.
        if (!response?.candidates || response.candidates.length === 0) {
          throw new Error('Invalid or empty response from API.');
        }
        this.updateTokenUsage(model, response);
        this.apiPolicyManager.reportApiSuccess(this.apiName, model);

        const firstCandidate = response.candidates[0];
        if (firstCandidate?.content?.parts) {
          for (const part of firstCandidate.content.parts) {
            if (part.text) {
              const runawayLoopPattern = /(.)\1{50,}\s*$/;
              
              if (runawayLoopPattern.test(part.text)) {
                part.text = "[System Note: This response was discarded because it entered a runaway token loop (excessive character repetition). Please resume the task and ensure formatting is concise and does not use excessive repeated characters.]";
              } else {
                part.text = part.text.replace(/-{10,}/g, '---');
              }
            }
          }
        }

        return response;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof DOMException && error.name === 'AbortError') {
          return this._createErrorResponse('Request aborted.');
        }

        try {
          this.apiPolicyManager.reportApiFailure(this.apiName, model);
        } catch (apiError) {
          console.error('CRITICAL: apiPolicyManager.reportApiFailure failed:', apiError);
        }

        // --- Reactive Context Size Management ---
        // Check for 400 Bad Request indicating prompt is too long
        const isContextError = errorMessage.includes('400') && 
                             (errorMessage.includes('exceeds the limit') || 
                              errorMessage.includes('context length') || 
                              errorMessage.includes('prompt is too long'));

        if (isContextError && attempt < MAX_ATTEMPTS) {
          const toolBeginMarker = await this.config.context.getToolResultPrefix();
          const toolEndMarker = await this.config.context.getToolResultSuffix();

          const markers = [
            { begin: toolBeginMarker, end: toolEndMarker }, // Pair 1 (Highest priority)
            { begin: "@DOC/EDIT{", end: "END_EDIT" }, // Pair 2
          ];

          console.warn(`Attempt ${attempt} failed with context size error. Reactively reducing content and retrying immediately.`);
          currentContents = await this._reduceContents(currentContents, markers);
          continue; // Skip backoff, retry immediately with reduced content
        }
        // --- End Reactive Check ---

        if (attempt === MAX_ATTEMPTS) {
          return this._createErrorResponse(`Final attempt (${attempt}) failed. Error: ${errorMessage}`);
        }
        
        let delay: number;
        const defaultDelay = Math.pow(2, attempt) * 1000;

        // Try to parse the API-suggested delay
        const apiDelayMs = this._parseRetryDelayFromString(errorMessage);

        if (apiDelayMs !== null) {
          // Use API suggested delay + 1s buffer
          delay = apiDelayMs + 1000;
          console.log(
            `API suggested retry delay of ${apiDelayMs / 1000}s. Waiting ${
              delay / 1000
            }s...`
          );
        } else {
          // Fallback to exponential backoff
          delay = defaultDelay;
        }

        console.warn(
          `Attempt ${attempt} failed with error: ${errorMessage}. Retrying in ${
            delay / 1000
          }s...`,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return this._createErrorResponse('All retry attempts failed unexpectedly.');
  }

  /**
   * Sends a single "one-shot" message to the LLM.
   */
  public async sendOneShotMessage(
    prompt: string | Part[],
    options?: GenerateContentOptions,
  ): Promise<GenerateContentResponse> {
    const model = options?.model || DEFAULT_GEMINI_FLASH_MODEL;
    
    const toolsArray: Tool[] = [];
    if (options?.enableGrounding) {
        toolsArray.push({ googleSearch: {} });
    }

    const generateConfig: GenerateContentConfig = {
      temperature: options?.temperature,
      tools: toolsArray.length > 0 ? toolsArray : undefined,
      // thinkingConfig: options?.enableThinking ? { includeThoughts: true } : undefined,
    };
    if (options?.enableGrounding && generateConfig.temperature === undefined) {
        generateConfig.temperature = 0;
    }

    const contents: Content[] = [
      {
        role: 'user',
        parts: typeof prompt === 'string' ? [{ text: prompt }] : prompt,
      },
    ];

    return this._generateContentWithRetries(
      model,
      contents,
      generateConfig,
      options?.signal,
    );
  }

  public async sendTranscriptMessage(
    transcriptManager: TranscriptManager | undefined,
    options?: GenerateContentOptions,
  ): Promise<GenerateContentResponse> {
    const model = options?.model || DEFAULT_GEMINI_FLASH_MODEL;

    const toolsArray: Tool[] = [];
    
    // Handle Google Search (Grounding)
    if (options?.enableGrounding) {
      toolsArray.push({ googleSearch: {} });
    }

    // FIX: Map local tool types to SDK SchemaType Enums
    if (options?.tools && options.tools.length > 0) {
      toolsArray.push({
        functionDeclarations: options.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: Type.OBJECT,
            properties: Object.entries(tool.parameters.properties).reduce((acc, [key, prop]) => {
              acc[key] = {
                type: Type.STRING, // Converting hardcoded 'string' to SchemaType.STRING
                description: prop.description
              };
              return acc;
            }, {} as any),
            required: tool.parameters.required
          }
        }))
      });
    }

    const generateConfig: GenerateContentConfig = {
      temperature: options?.temperature,
      tools: toolsArray.length > 0 ? toolsArray : undefined,
    };
    if (options?.enableGrounding) {
      if (generateConfig.temperature === undefined) {
        generateConfig.temperature = 0;
      }
    }

    const contents: Content[] = this._mapFormattedTranscriptToContent(transcriptManager?.getTranscript() ?? []);

    const response = await this._generateContentWithRetries(
      model,
      contents,
      generateConfig,
      options?.signal,
    );

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      const hasFunctionCalls = modelContent.parts?.some(part => !!part.functionCall);

      if (hasFunctionCalls) {
        // Pass structured parts for function calls
        transcriptManager?.addEntry(
          modelContent.role ?? 'model',
          modelContent.parts as any, 
          {},
          false
        );
      } else {
        const newTranscriptEntry = (modelContent.parts ?? [])
          .map(part => ('text' in part ? part.text : ''))
          .join('\n');

        if (newTranscriptEntry === '---The Gemini API was unable to provide a response---') {
          return response;
        }

        // Clean repetitive output before transcript management
        const dedupedTranscriptEntry = this._removeRepetitiveBlocks(newTranscriptEntry);

        const cleanTranscriptEntry =
          (await transcriptManager?.cleanLLMResponse(dedupedTranscriptEntry)) ||
          dedupedTranscriptEntry;

        transcriptManager?.addEntry(
          modelContent.role ?? 'model',
          cleanTranscriptEntry,
          {},
          false,
        );

        if (response.candidates?.[0]?.content) {
          response.candidates[0].content.parts = [{ text: cleanTranscriptEntry }];
        }
      }
    }

    return response;
  }
}