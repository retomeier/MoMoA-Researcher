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

import { DEFAULT_GEMINI_FLASH_MODEL } from "../config/models.js";
import { FAQ, MultiAgentToolContext } from "../momoa_core/types.js";
import { getAssetString, getToolPreamblePrompt, replaceRuntimePlaceholders } from "../services/promptManager.js";
import { TranscriptManager } from "../services/transcriptManager.js";
import { getFileDescriptions } from "./fileAnalysis.js";

const faqs = new Map<string, FAQ>();

/**
 * Adds a new question and answer to the list.
 * @param question The question to be added.
 * @param answer The corresponding answer.
 */
export async function addFAQ(question: string, answer: string, toolContext: MultiAgentToolContext): Promise<void> {
  const multiAgentGeminiClient = toolContext.multiAgentGeminiClient;

  const faqSummarizerPrompt = `I have a SDLC agent working on a project. To help it, I am maintaining a list of questions it has asked, and the corresponding answers provided by an expert collaborator. The answers provided typically provide more than enough context, allowing us to significantly reduce the length and complexity of the questions. With that in mind, please review this question and answer, and respond with a short, concise alternative "question" in one to three sentences.\n**Question to Rewrite:**\n${question}\n\n**Answer to the Question:**\n${answer}`;

  try {
    const summarizedQuestion = (await multiAgentGeminiClient.sendOneShotMessage(
      faqSummarizerPrompt, 
      { model: DEFAULT_GEMINI_FLASH_MODEL }))?.text || '';

    const newFAQ = 
    {
      question: summarizedQuestion,
      answer,
      created: new Date()
    }
    faqs.set(question, newFAQ);
    await updateFAQs(toolContext);
  } catch (error) {}
}

async function updateFAQs(toolContext: MultiAgentToolContext) { 
  const multiAgentGeminiClient = toolContext.multiAgentGeminiClient;
  const toolPrefix = await getAssetString('tool-prefix')

  const basePrompt = await getToolPreamblePrompt('faq-updater');
  const eachPrompt = await replaceRuntimePlaceholders(basePrompt, 
    {
      CurrentFiles: getFileDescriptions() ?? "--No files available--",
      CurrentFAQs: getFAQs()
    }
  )

  // Regex for parsing tool responses
  // Using 's' flag for (.*?) to allow '.' to match newline characters within question/answer text.
  const deleteRegex = new RegExp(`^${toolPrefix}DELETEFAQ\\{(.*?)\\}ENDDELETE$`, 's');
  const updateRegex = new RegExp(`^${toolPrefix}UPDATEFAQ\\{(.*?)\}\\nNEWANSWER\\{(.*?)\}\\nENDUPDATE$`, 's');
  const returnRegex = new RegExp(`^${toolPrefix}RETURN$`);

  const faqMaintainer = new TranscriptManager({ 
        context: toolContext.infrastructureContext 
      });
  faqMaintainer.addEntry('user', eachPrompt, { documentId: 'BASE_PROMPT', replacementIfSuperseded: eachPrompt});
  
  const maxTurns = faqs.size + 2;
  let turn = -1;
  let continueProcessing = true;
  
  while (turn < maxTurns && continueProcessing) {
    turn++;

    const eachPrompt = await replaceRuntimePlaceholders(basePrompt, 
      {
        CurrentFiles: getFileDescriptions() ?? "--No files available--",
        CurrentFAQs: getFAQs()
      }
    )
    faqMaintainer.replaceEntry('BASE_PROMPT', eachPrompt);

    const llmMessage = await multiAgentGeminiClient.sendTranscriptMessage(
      faqMaintainer, 
      { 
        model: DEFAULT_GEMINI_FLASH_MODEL,
        enableThinking: true
      }
    );
    let response = llmMessage.text || '';

    // 1. Check for RETURN tool
    if (returnRegex.test(response))
      return

    // 2. Check for UPDATE tool
    const updateMatch = response.match(updateRegex);
    if (updateMatch) {
      const questionToUpdate = updateMatch[1].trim();
      const newAnswer = updateMatch[2].trim();
      
      if (faqs.has(questionToUpdate)) {
        const existingFAQ = faqs.get(questionToUpdate);
        if (existingFAQ) {
          existingFAQ.answer = newAnswer;
          existingFAQ.created = new Date();
        }
      }
      continue;
    }

    // 3. Check for DELETE tool
    const deleteMatch = response.match(deleteRegex);
    if (deleteMatch) {
      const questionToDelete = deleteMatch[1].trim();
      faqs.delete(questionToDelete);
      continue;
    }
  }
}

/**
 * Retrieves all FAQs as a single formatted string.
 * @returns A formatted string of all questions and answers.
 */
export function getFAQs(): string {
  if (faqs.size === 0)
    return "--No FAQs have been added--";

  // Convert the Map values to an array
  const faqsArray = Array.from(faqs.values());

  // Sort the FAQs by the 'Created' date in ascending order
  faqsArray.sort((a, b) => a.created.getDate() - b.created.getDate());

  // Format each FAQ into a string and join them
  const faqString = faqsArray.map(faqEntry => {
    const createdDate = faqEntry.created.toLocaleString();
    return `Question:\n${faqEntry.question}\nAdded:\n${createdDate}\nAnswer:\n${faqEntry.answer}\n----`;
  }).join("\n\n");

  return "--No FAQs have been added--";
  return faqString;
}
