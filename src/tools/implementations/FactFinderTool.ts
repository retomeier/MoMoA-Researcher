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
import { addFAQ } from '../../utils/faqs.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { DEFAULT_GEMINI_FLASH_MODEL, DEFAULT_GEMINI_LITE_MODEL, DEFAULT_GEMINI_PRO_MODEL } from '../../config/models.js';
import { removeBacktickFences } from '../../utils/markdownUtils.js';
import { getAssetString, getToolPreamblePrompt, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { TranscriptManager } from '../../services/transcriptManager.js';
import { Part } from '@google/genai';

/**
 * Helper function to fetch content from a URL and summarize it using an LLM.
 */
async function fetchWebInfo(
  url: string,
  question: string,
  context: MultiAgentToolContext
): Promise<string> {
  const webSummaryModel = DEFAULT_GEMINI_FLASH_MODEL;

  let result = `The result from the Internet Lookup tool is:\n`;
 
  try {
    const response = await fetch(url, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
 
    const rawData = await response.text();

    const data = await context.multiAgentGeminiClient.trimToTokenLimit(webSummaryModel, rawData, 0.8);
 
    const request =
`The following text has been obtained from ${url}. Please review it and provide a well formatted short summary that answers the question '${question}' as well as possible given the text available. 

If you're unsure you should say so, it's important that you don't give a false sense of confidence if you're not sure. If the answer is ambiguous and there are likely multiple different answers you should be clear about that If the available text is unrelated to the question, or doesn't provide helpful information then just respond saying 'This webpage doesn't have useful information to answer this question.'

CRITICAL: If the content appears to be a raw data file, source code, or a long list (e.g. word lists, datasets) that is truncated: 
 1. Do NOT try to summarize the content itself.
 2. You MUST explicitly output: "**Target URL:** ${url}".
 3. State clearly that this file contains the requested data and must be downloaded separately.

If the information is coming from the Wikipedia API, each of the "title" elements is the name of a Wikipedia page. If (and only if) the result includes the name of a Wikipedia page that would provide a better answer, you can say that in your response and provide the page title but you MUST NOT do that if the page title isn't CLEARLY and DIRECTLY relevant to the question you're answering.

Here is the text from the website:
${data}`;
 
    const webSummary = (await context.multiAgentGeminiClient.sendOneShotMessage(
      request,
      { model: webSummaryModel, signal: context.signal }
    ))?.text || '';
    
    result += removeBacktickFences(webSummary).trim();
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    result = `It was unable to retrieve any information from ${url} because ${errorMessage}`;
  }
 
  return result;
}
 
/**
 * Implements the Fact Finder Tool, which consolidates information from project files (Docs)
 * and external web searches (Internet Lookup) to answer a question.
 */
export const factFinderTool: MultiAgentTool = {
  displayName: "Fact Finder",
  name: 'FACTFINDER',
 
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const question = params.question;
    const toolPrefix = await getAssetString('tool-prefix');
 
    // Consistent logging helper
    const updateLog = async (message: string, updateOverseerLog: boolean = true) => {
      context.sendMessage(JSON.stringify({
        status: 'WORK_LOG',
        message: message,
      }));
      if (updateOverseerLog) context.overseer?.addLog(message);
    };

    await updateLog(`${this.displayName} Invoked for question: ${question}`);
 
    let providedInformation = "---No Additional Information Provided---";
    let internetSearchResult = "Internet Search Provided No Useful Results";
 
    // --- 2. Internet Search Part ---
    try {
      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: `Performing multi-turn Internet Search.`,
      });

      const internetLookupToolString = 
`You are an Internet search expert that can use a tool to look up information on the Internet. This is generally limited to URLs that represent APIs that don't require any authentication, and many websites won't be accessible to you. If you try to access a website and get a response that the Fetch Failed you should assume it's because you don't have permission to see it and just accept that you can't see it. Requests for internet lookups require both a URL to look at, and a question you want to get answered from that page.
    
**Use the following tool syntax:**
${toolPrefix}INTERNET/LOOKUP{Full URL,Question you want answered}

You MUST specify both a URL and a question to answer.

**Guidance:**
You can try any website, but one useful site is Wikipedia, which can help you verify factual information. There are two ways to access information from Wikipedia. The first is using the search API URL, which will provide a brief summary from any Wikipedia page that matches the search term. This is the format of the URL to search Wikipedia:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&list=search&srsearch=SEARCHTERM

If you know the specific page from Wikipedia you want to look at, the format of the URL to see a particular Wikipedia page is:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=revisions&rvprop=content&titles=PAGENAME

You must use the Internet Lookup to try and get factual answers to the question you've been asked to answer. Don't limit yourself to Wikipedia, and NEVER rely on your own knowledge or intuition, you must only provide information based on Internet Lookup results. That will mean providing different questions and / or different websites with different URLs. When you are confident you have a good answer, or that you can't get a good answer, use the ${toolPrefix}RETURN keyword, followed by your best answer to the question based on the Internet Lookup results. Only your response *after* the RETURN keyword will be returned, so make sure that all relevant information is AFTER that return keyword in your response.

It's important that if you can't find useful results that answer your question you simply respond by saying 'Internet Search provided no useful additional context'. Do not speculate on how the information would best be obtained.

**Special Instruction for Files/Datasets:**
If the user asks for a specific file, dataset, or list (e.g., "Wordle word list"), your primary goal is to find the **direct URL** to the raw text or data file.
  1. Search for terms like "raw", "githubusercontent", "txt", "json", or "csv".
  2. Once you find a promising URL, verify it using ${toolPrefix}INTERNET/LOOKUP.
  3. If the lookup confirms it is the correct data, STOP and return that URL as the answer.

**Question to be answered:**
${question}`;
 
      const internetSearchChat = new TranscriptManager({ context: context.infrastructureContext });
      internetSearchChat.addEntry('user', internetLookupToolString);
 
      const lookupRegex = new RegExp(`${toolPrefix}INTERNET/LOOKUP\\{(.*?)\\}`, 's');
      const returnRegex = new RegExp(`${toolPrefix}RETURN`, 's');
 
      const maxTurns = 10;
      let turns = 0;
      let internetSearchIsDone = false;
 
      while (!internetSearchIsDone && turns < maxTurns) {
        const llmResponse = await context.multiAgentGeminiClient.sendTranscriptMessage(
          internetSearchChat,
          { model: DEFAULT_GEMINI_FLASH_MODEL, signal: context.signal }
        );
        let responseText = llmResponse.text || '';
        internetSearchChat.addEntry('model', responseText);
        
        await updateLog(`# Internet search tool\n${responseText}`, false);
 
        let matched = false;
 
        // 1. Check for RETURN tool
        if (returnRegex.test(responseText)) {
          internetSearchIsDone = true;
          internetSearchResult = responseText.split(returnRegex)[1].trim();
          matched = true;
        }
 
        // 2. Check for INTERNET/LOOKUP tool
        if (!matched) {
          const lookupMatch = responseText.match(lookupRegex);
          if (lookupMatch) {
            const requestString = lookupMatch[1].trim();
            const lookupRequest = requestString.split(",", 2);
 
            let webLookupResult: string;
            if (lookupRequest.length === 2) {
              const lookupURL = lookupRequest[0].trim();
              const lookupQuery = lookupRequest[1].trim();
              // Pass a wrapped logger to the helper
              webLookupResult = await fetchWebInfo(lookupURL, lookupQuery, context);
            } else {
              webLookupResult = "Invalid syntax. You must specify a URL and a question, separated by a comma.";
            }

            await updateLog(`Lookup result:\n${webLookupResult}`, false);
            
            internetSearchChat.addEntry('user', webLookupResult);
            matched = true;
          }
        }
 
        turns++;
        if (turns >= maxTurns && !internetSearchIsDone) {
          internetSearchResult = "Internet Search Provided No Useful Results (Max turns reached)";
          internetSearchIsDone = true;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateLog(`Internet Search failed: ${errorMessage}`);
      internetSearchResult = `Internet Search Failed Due to Error: ${errorMessage}`;
    }
 
 
    // --- 3. Final Synthesis ---
    context.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: `Synthesizing final answer using all gathered facts.`,
    });

    const replacementValues = {
      ExplicitlyProvided: providedInformation,
      SearchResults: internetSearchResult,
      Question: question
    };
 
    let factFinderPreamble = await getToolPreamblePrompt('fact-finder-preamble');
    factFinderPreamble = await replaceRuntimePlaceholders(factFinderPreamble, replacementValues);
    updateLog(`#Fact Finder\n${factFinderPreamble}`);
 
    const parts: Part[] = [];
    if (context.initialImage && context.initialImageMimeType) {
      parts.push({
        inlineData: {
          mimeType: context.initialImageMimeType, 
          data: context.initialImage,
        }
      });
    }
    parts.push({ text: factFinderPreamble });

    const resultResponse = await context.multiAgentGeminiClient.sendOneShotMessage(
      parts,
      { model: DEFAULT_GEMINI_PRO_MODEL, enableThinking: true, enableGrounding: true, signal: context.signal }
    );
    
    let result = resultResponse.text || "";
    result = removeBacktickFences(result).trim();

    if (!result) {
      const candidate = resultResponse.candidates?.[0];
      if (candidate) {
        if (candidate.finishReason !== 'STOP') {
            updateLog(`**FactFinder Warning:** Response stopped due to: ${candidate.finishReason}`);
        }
        result = candidate.content?.parts?.map(p => p.text).join('\n').trim() || "";
      }
    }

    if (!result) {
      result = "Fact Finder failed to generate a response.";
    }

    const completed_status_message_prompt = await replaceRuntimePlaceholders(await getAssetString("summarize-progress-start"), {
      LastOrchestratorResponse: result
    });
        
    try {
      const opinionSummaryPromise = context.multiAgentGeminiClient.sendOneShotMessage(
        completed_status_message_prompt,
        { model: DEFAULT_GEMINI_LITE_MODEL, signal: context.signal }
      ).then(msg => msg.text || "");
      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: opinionSummaryPromise,
      });
    } catch (_error) {}
 
    // --- 4. FAQ Update ---
    await addFAQ(question, result, context);
 
    return { result: result };
  },
 
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    if (invocation.trim()) {
      const question = invocation.trim();
      return {
        success: true, 
        params: {
          question
        }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax for ${this.displayName} Tool. No question was provided.`
      }
    }
  }
};