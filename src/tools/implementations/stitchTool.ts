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
  DesignResponseItem, 
  ExtractedData, 
  MultiAgentToolContext, 
  MultiAgentToolResult, 
  ToolParsingResult } from '../../momoa_core/types.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../../config/models.js';
import { getToolPreamblePrompt, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { removeBacktickFences } from '../../utils/markdownUtils.js';
import { StitchToolClient, StitchError } from "@google/stitch-sdk";
import { TranscriptManager } from '../../services/transcriptManager.js';

/**
 * Implements the Stitch Tool (UI Designer) using the @google/stitch-sdk.
 */
export const stitchTool: MultiAgentTool = {
  displayName: "Stitch UI Designer",
  name: 'STITCH',
  endToken: '}STITCH',

  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const updateProgress = async (message: string, tellOverseer: boolean = false) => {
      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: message,
      });
      if (tellOverseer)
        context.overseer?.addLog(message);
    };

    const startTime = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000; 
    const question = params.question;
    const deviceType = params.deviceType;

    if  (!context.secrets.stitchApiKey) 
        return { result: "No Stitch API key was provided."}

    try {
      const client = new StitchToolClient({
        apiKey: `${context.secrets.stitchApiKey}`
      });

      // Create a new Stitch Project
      updateProgress(`Creating a new Stitch project targeting ${deviceType}.`);
      const createResult = await client.callTool<any>("create_project", {
        title: context.sessionTitle ?? 'Untitled MoMoA Project',
      });

      // Extract Project ID
      let projectId: string | undefined;
      if (createResult && typeof createResult === 'object') {
        projectId = createResult.id || createResult.projectId || createResult.name?.split('/').pop();
      }

      if (!projectId) {
        throw new Error("Failed to retrieve a valid Project ID from Stitch.");
      }

      const projectUrl = `https://stitch.withgoogle.com/projects/${projectId}`;
      updateProgress(`New Stitch project created at: [${projectUrl}](${projectUrl})`);

      let uiDesignPrompt = await getToolPreamblePrompt('ui-design-preamble');
      uiDesignPrompt = await replaceRuntimePlaceholders(
        uiDesignPrompt, 
        {
          ProblemSummary: question,
        });

      let currentPrompt = uiDesignPrompt;
      let totalAttempts = 0;
      let retryDelay = 2000; 

      // --- Setup Q&A Transcript for Clarifications ---
      const stitchQnATranscript = new TranscriptManager({ 
          context: context.infrastructureContext 
      });
      const chatHistoryString = context.transcriptForContext.getTranscriptAsString(true, context.experts) || "--No Chat History Available--";
      const initialPreamble = `You are an expert UI/UX designer helping an AI design tool named Stitch.
Stitch is generating a UI screen and may ask clarifying questions.
Your responsibility is to provide clear, direct, and helpful responses based on the full context of the provided Project Conversation History.
Do not be conversational; provide only the necessary information to answer the questions. Answer the question as "full sentence answers" that incorporate the question into the response to ensure clarity.

You **MUST NOT** attempt to invoke tools. You **must** provide your response to Stitch in a single response. 

---PROJECT CONVERSATION HISTORY---
${chatHistoryString}
------------------------------------

You will now receive questions from Stitch.`;
      
      stitchQnATranscript.addEntry('user', initialPreamble);

      // Loop with Backoff and Timeout
      while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed > TEN_MINUTES_MS) {
          throw new Error("Stitch UI generation timed out after 10 minutes of attempts.");
        }

        totalAttempts++;
        
        try {
          const rawResponse = await client.callTool<any>('generate_screen_from_text', {
            projectId: projectId,
            prompt: currentPrompt,
            deviceType: deviceType
          });

          const stitchDesignResult = parseStichDesign(rawResponse.outputComponents);
          const stitchMessage: string = stitchDesignResult.combinedText;
          updateProgress(`Final message from Stitch:\n${stitchMessage}`);

          if (stitchDesignResult.hasPreviewUrls) {
            updateProgress(`Downloading ${stitchDesignResult.previewUrls.length + stitchDesignResult.htmlUrls.length} design assets.`);

            let successMessage = `The preview images and HTML for this design have been saved to:`;

            let downloadedCount = 0;
            for (const imageUrl of stitchDesignResult.previewUrls) {
              // Download Image
              const imageResponse = await fetch(imageUrl);
              if (!imageResponse.ok) continue;
              const base64Image = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
              downloadedCount++;

              const timestamp = Date.now();
              const imgFilename = `stitch_images/ui_${timestamp}.png`;

              context.binaryFileMap.set(imgFilename, base64Image);
              context.editedFilesSet.add(imgFilename);

              successMessage += `\n* ${imgFilename}`;
            }

            for (const htmlUrl of stitchDesignResult.htmlUrls) {
              // Download HTML
              const htmlResponse = await fetch(htmlUrl);
              if (!htmlResponse.ok) throw new Error(`Failed HTML download: ${htmlResponse.status}`);
              const htmlContent = await htmlResponse.text();
              downloadedCount++;

              const timestamp = Date.now();
              const htmlFilename = `stitch_code/ui_${timestamp}.html`;

              context.fileMap.set(htmlFilename, htmlContent);
              context.editedFilesSet.add(htmlFilename);
              successMessage += `\n* ${htmlFilename}`;
            }

            if (stitchDesignResult.designMarkdown) {
              const timestamp = Date.now();
              const designFilename = `stitch_design/design_${timestamp}.md`;

              context.fileMap.set(designFilename, stitchDesignResult.designMarkdown);
              context.editedFilesSet.add(designFilename);
              successMessage += `\n* ${designFilename}`;
            }

            if (downloadedCount > 0)
              successMessage += "\nUse the File Reader tool to view the contents of these files and images.";
            else
              successMessage = "I was unable to save preview image or HTML for this design."

            updateProgress(successMessage);

            if (stitchMessage)
              successMessage = `${stitchMessage}\n\n${successMessage}`;
            
            return { result: successMessage };
          }

          if (stitchMessage) {
            const combinedText = stitchMessage;
                
            if (combinedText.trim() !== "") {
              updateProgress(`Stitch is asking for clarification:\n${combinedText}`);
              
              stitchQnATranscript.addEntry('user', `Message from Stitch:\n"${combinedText}"`);

              const llmResponse = await context.multiAgentGeminiClient.sendTranscriptMessage(
                stitchQnATranscript,
                { model: DEFAULT_GEMINI_FLASH_MODEL }
              );

              const llmResponseText = llmResponse?.text || "Proceed with standard UI/UX best practices.";
              stitchQnATranscript.addEntry('model', llmResponseText);
              
              const answer = removeBacktickFences(llmResponseText);
              updateProgress(`I told Stitch:\n${answer}`);

              currentPrompt = answer;
              continue; 
            }
          }

          throw new Error("Stitch returned no screens and no clarifying questions.");

        } catch (innerError: any) {
          // Check for recoverable errors via the SDK
          const isRecoverable = innerError instanceof StitchError && innerError.recoverable;
          const remainingTime = TEN_MINUTES_MS - (Date.now() - startTime);

          if (isRecoverable && remainingTime > retryDelay) {
            updateProgress(`Recoverable error [${innerError.code}]. Retrying in ${retryDelay / 1000}s...`);
            await new Promise(res => setTimeout(res, retryDelay));
            retryDelay = Math.min(retryDelay * 2, 30000); 
            continue; 
          }
          throw innerError;
        }
      }
    } catch (error: any) {
      let errorMessage = error.message;
      if (error instanceof StitchError) {
        errorMessage = `[${error.code}] ${error.message}`;
      }
      
      const errResult = `An error occurred while asking for a UI Design: ${errorMessage}`;
      updateProgress(errResult);
      return { result: errResult };
    }
  },

  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    const trimmed = invocation.trim();
    if (!trimmed) {
      return { success: false, error: "No prompt provided." };
    }

    let question = trimmed;
    let deviceType = 'DESKTOP'; // Default fallback

    // 1. Extract the deviceType if it's placed at the end after a comma.
    const match = trimmed.match(/^(.*),\s*(MOBILE|DESKTOP|TABLET|AGNOSTIC)\s*$/i);
    
    if (match) {
      question = match[1].trim();
      deviceType = match[2].toUpperCase(); 
    }

    // 2. Strip surrounding quotes from the question if they exist
    if (
      (question.startsWith('"') && question.endsWith('"')) ||
      (question.startsWith("'") && question.endsWith("'"))
    ) {
      question = question.slice(1, -1).trim();
    }

    return question 
      ? { success: true, params: { question, deviceType } } 
      : { success: false, error: "No prompt provided after parsing." };
  }
};

function parseStichDesign(payload: DesignResponseItem[]): ExtractedData {
  const htmlUrls: string[] = [];
  const previewUrls: string[] = [];
  const textElements: string[] = [];
  let designMarkdown = "";
  let hasPreviewUrls = false;

  for (const item of payload) {
    // 1. Extract Design Markdown
    if (item.designSystem?.designSystem?.theme?.designMd) {
      designMarkdown = item.designSystem.designSystem.theme.designMd;
    }

    // 2. Extract URLs from Screens
    if (item.design?.screens) {
      for (const screen of item.design.screens) {
        if (screen.htmlCode?.downloadUrl) {
          htmlUrls.push(screen.htmlCode.downloadUrl);
        }
        if (screen.screenshot?.downloadUrl) {
          previewUrls.push(screen.screenshot.downloadUrl);
        }
      }
    }

    // 3. Extract Text Elements
    if (item.text) {
      textElements.push(item.text);
    }
  }

  const combinedText = textElements.join(String.fromCharCode(10));

  hasPreviewUrls = (htmlUrls.length + previewUrls.length) > 0;

  return {
    htmlUrls,
    previewUrls,
    combinedText,
    designMarkdown,
    hasPreviewUrls
  };
}