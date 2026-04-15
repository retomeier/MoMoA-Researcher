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

import { DEFAULT_GEMINI_FLASH_MODEL, DEFAULT_GEMINI_LITE_MODEL } from "../config/models.js";
import { GeminiClient } from "../services/geminiClient.js";
import { getAssetString, getExpertPrompt, getWorkPhasePrompt, hasExpertPrompt, replaceRuntimePlaceholders, resolvePlaceholdersFromFiles } from "../services/promptManager.js";
import { AddEntryOptions, TranscriptManager } from "../services/transcriptManager.js";
import { PROJECT_DIFF_ID } from "../tools/implementations/revertFileTool.js";
import { parseToolRequest } from "../tools/multiAgentToolParser.js";
import { executeTool, getTool } from "../tools/multiAgentToolRegistry.js";
import { generateDiffString } from "../utils/diffGenerator.js";
import { getTaskRelevantFileDescriptions } from "../utils/fileAnalysis.js";
import { formatExpertList, removeBacktickFences, replaceContentBetweenMarkers, toKebabCase } from "../utils/markdownUtils.js";
import { Overseer } from "./overseer.js";
import { Expert, MultiAgentToolContext, GuidanceType } from "./types.js";
import { getFAQs } from "../utils/faqs.js";
import { getFormattedCacheContents } from "../tools/implementations/urlFetchTool.js";
import { withDeadline } from "../utils/timeoutHelper.js";

const NO_RESULT_STRING = 'Sorry, this Work Phase was unable to perform the allocated task.';

const emptySummary = 
`{
  "confidence_score": "low",
  "key_outcome_achieved": "${NO_RESULT_STRING}",
  "positive_aspects": "",
  "difficulties_or_unresolved_issues_within_task": "",
  "new_consequences_or_dependencies_for_project": "", 
  "critical_assumptions_made": "", 
  "recommended_direct_next_steps": "",
  "other_pertinent_notes": ""
}`;

/**
 * The WorkPhase class manages the execution of a specific work phase,
 * coordinating interactions between multiple AI agents (experts) and tools.
 */
export class WorkPhase {
  private multiAgentGeminiClient: GeminiClient;
  private sendMessage: (message: any) => void;
  private task: string;
  private initialPrompt: string;
  private lastOrchestratorMessage: string;
  private assumptions: string;
  private maxAllowedTurns: number;
  private overseer: Overseer | undefined;
  private toolContext: MultiAgentToolContext; // Store the full tool context
  private experts: Expert[];
  private signal?: AbortSignal; // NEW: AbortSignal property

  /**
   * Initializes a new instance of the WorkPhase.
   * @param task The specific task for this work phase.
   * @param initialPrompt The initial prompt provided to the orchestrator.
   * @param lastOrchestratorMessage The last message sent by the orchestrator before starting this work phase.
   * @param assumptions Additional context/assumptions.
   * @param overseer An instance of the Overseer for logging and feedback.
   * @param toolContext The complete ToolContext object containing all necessary dependencies for tools.
   * @param maxAllowedTurns The maximum number of turns allowed for the work phase.
   * @param signal Optional AbortSignal for cancellation.
   */
  constructor(
    task: string,
    initialPrompt: string,
    lastOrchestratorMessage: string,
    assumptions: string,
    overseer: Overseer | undefined,
    toolContext: MultiAgentToolContext,
    maxAllowedTurns: number,
    signal?: AbortSignal,
  )
  {
    this.task = task;
    this.initialPrompt = initialPrompt;
    this.lastOrchestratorMessage = lastOrchestratorMessage;
    this.assumptions = assumptions;
    this.maxAllowedTurns = maxAllowedTurns;
    this.overseer = overseer;
    this.toolContext = toolContext;
    this.signal = signal;

    // Extract properties from toolContext for direct access within WorkPhase
    this.multiAgentGeminiClient = toolContext.multiAgentGeminiClient;
    this.sendMessage = toolContext.sendMessage;
    this.experts = [];
  }

  private async updateLog(message: string, updateOverseerLog: boolean = true) {
    this.sendMessage(JSON.stringify({
      status: 'WORK_LOG',
      message: message,
    }));

    if (updateOverseerLog)
      this.overseer?.addLog(message);
  }

    private async updateProgressLog(message: string | Promise<string>) {
    this.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: message,
    });
  }

  private async summarizeExpertUpdate(expertResponse: string): Promise<string> {
    let current_status_message = "Trying to solve this problem..."

    const completed_status_message_prompt = await replaceRuntimePlaceholders(await getAssetString("summarize-progress-start"), {
      LastOrchestratorResponse: expertResponse
    });
    
    try {
      current_status_message = (await this.multiAgentGeminiClient.sendOneShotMessage(
        completed_status_message_prompt,
        { model: DEFAULT_GEMINI_LITE_MODEL, signal: this.signal }
      ))?.text || current_status_message;
    } catch (_error) {
      // Intentionally empty: error during summarization should not halt the orchestrator
    }

    return current_status_message;
  }

  /**
   * Runs the work phase loop.
   * @returns A promise that resolves with the result of the work phase.
   */
  public async run(): Promise<{result: string; retrospective: string | undefined;}> {
    const expertCount = 2; // Changed to const
    const filePrefix = await getAssetString('file-content-prefix');
    const fileSuffix = await getAssetString('file-content-suffix');
    const urlPrefix = await getAssetString('url-content-prefix');
    const urlSuffix = await getAssetString('url-content-suffix');
    const logReplacementString = '---CONTENT INTENTIONALLY REMOVED---';

    let workPhaseResult: string = NO_RESULT_STRING;

    this.updateLog(`Selecting Work Phase and Experts...`);

    const workPhaseRoomSelectionPrompt = await replaceRuntimePlaceholders(
      await getAssetString("workphase-finder-preamble"),
      { taskDescription: this.task }
    );

    let workphaseName = (await this.multiAgentGeminiClient.sendOneShotMessage(
      workPhaseRoomSelectionPrompt,
      { model: DEFAULT_GEMINI_LITE_MODEL, signal: this.signal }
    ))?.text || "general";
    workphaseName = removeBacktickFences(workphaseName);

    const {
      preamble: workphasePreamble,
      temperature: workphaseTemperature,
      model: workphaseModel,
      tools: workphaseTools,
    } = await getWorkPhasePrompt(toKebabCase(workphaseName));

    let workPhaseToolPlaceholders = workphaseTools ? workphaseTools
      .split(',')
      .map((t: string) => `\${tool-instructions/${t.trim().slice(1, -1)}}`)
      .join('\n\n----\n\n') : '';

    if (workPhaseToolPlaceholders) 
      workPhaseToolPlaceholders += "\n\n----\n\n";
    
    const expandedWorkphaseTools = workphaseTools ? await resolvePlaceholdersFromFiles(workPhaseToolPlaceholders) : '';

    const roomPromptTemplate = await getAssetString('chat-room-preamble');
    const roomPromptTemplateReplaced = await replaceRuntimePlaceholders(
      roomPromptTemplate,
      {
        MaxTurns: String(this.maxAllowedTurns),
        WorkphasePreamble: workphasePreamble,
        WorkphaseTools: expandedWorkphaseTools,
      }
    );

    const selectedExpertNames: string[] = [];    
    const expertSelectionPrompt = await replaceRuntimePlaceholders(
      await getAssetString("expert-finder-preamble"),
      { taskDescription: this.task }
    );

    this.toolContext.experts = [];
    this.toolContext.transcriptsToUpdate = this.toolContext.transcriptsToUpdate.slice(0,1);

    let originalPrompt = this.initialPrompt;
    const originalPromptDivider = "Consider the following additional guidance when completing the task:"
    if ((this.initialPrompt.includes(originalPromptDivider)) && (workphaseName.toLowerCase().trim() === "validation"))
      originalPrompt = this.initialPrompt.substring(0, this.initialPrompt.indexOf(originalPromptDivider));


    if (workphaseName.toLowerCase().trim() === "validation")
      this.task = "The unified diff is the ground truth of changes to the project's files. Validate that these changes fully meet the Project Definition requirements. You must also validate that the changes made are within the scope of the original user request, and that the changes do not affect unrelated aspects of the project, and revert or report any 'scope creep' or unrequested functional changes. Your responsibility to validate against the Project Definition is more important than the Project Orchestrator's context.";

    const projectDetailsString = `
# Overall Project Definition
## Project Requirements
${originalPrompt}

${(workphaseName.toLowerCase().trim() === "validation") ? '' :
`## Project Orchestrator's Context when Assigning the Specific Task
${this.lastOrchestratorMessage}`}

## Valid Project-Scope Assumptions
The following guidance has been provided to the Project Orchestrator for guidance in completing the overall Project Requirements. You should try and follow these preferences, as long as they don't contradict anything in the Project Requirements or the Specific Task. If there is any contradiction, the Specific Task is correct:
${await getAssetString('base-assumptions')}
${this.assumptions}
    
# The Specific Task to be Completed in this Work Phase Room
${this.task}
`.trim();

    for (let i = 0; i < expertCount; i++) {
      const thisExpertSelectionPrompt =
        await replaceRuntimePlaceholders(
          expertSelectionPrompt,
          { existingExpert: selectedExpertNames.join('\n') }
        );

      let thisExpertName = 'General Knowledge Expert';
      try {
        thisExpertName = (await this.multiAgentGeminiClient.sendOneShotMessage(
        thisExpertSelectionPrompt,
        { model: DEFAULT_GEMINI_LITE_MODEL, signal: this.signal } 
        ))?.text || "General Knowledge Expert";
      } catch (error: any) {
        this.updateLog(`Error looking up expert ${i}:\n${error.message}`);
      }

      thisExpertName = removeBacktickFences(thisExpertName);

      if (!await hasExpertPrompt(toKebabCase(thisExpertName)))
        thisExpertName = "General Knowledge Expert";

      const { // Changed to const
        preamble: thisExpertPreamble,
        temperature: thisExpertTemperature,
        model: thisExpertModel,
      } = await getExpertPrompt(toKebabCase(thisExpertName));

      // Determine effective model name and temperature for this expert
      let inRoomTemperature = 1;

      let inRoomModel = thisExpertModel ?? workphaseModel ?? DEFAULT_GEMINI_FLASH_MODEL;

      const scaledTemperature = Math.min(Math.max(3 + (thisExpertTemperature - 3) + (workphaseTemperature - 3), 5), 0);
      inRoomTemperature = scaledTemperature === 0 ? 0 : (0.25 + (1.75 * (scaledTemperature - 1)) / 4);
      
      const thisTranscriptManager = new TranscriptManager({ 
        context: this.toolContext.infrastructureContext 
      });

      this.toolContext.transcriptsToUpdate.push(thisTranscriptManager);
      this.toolContext.experts.push(thisExpertName);
      
      this.experts.push(
        { 
          name: thisExpertName,
          transcript: thisTranscriptManager,
          model: inRoomModel,
          inRoomTemperature: inRoomTemperature
        }
      );
      selectedExpertNames.push(thisExpertName);

      const thisRoomPrompt = await replaceRuntimePlaceholders(
        roomPromptTemplateReplaced,
        { Persona: thisExpertPreamble }
      );
      thisTranscriptManager.addEntry('user', thisRoomPrompt);

      let faqString = "# Expert Answers to Frequently Asked Questions:\n";
      faqString += "---No FAQS have been added---";
      thisTranscriptManager.addEntry(
        'user',
        faqString,
        { documentId: "FAQ_ID", replacementIfSuperseded: faqString}
      );

      if (this.toolContext.initialImage && this.toolContext.initialImageMimeType) {
        const imageString = "# The user has attached this image to their prompt.";
        thisTranscriptManager.addImage(
          imageString,
          this.toolContext.initialImage,
          this.toolContext.initialImageMimeType
        );
      }      
      
      const existingFilesString = `# Available editable text-based files:\n${getTaskRelevantFileDescriptions()}\n\nBinary Files Summary:\n* ${this.toolContext.binaryFileMap.size} binary files.`;
      thisTranscriptManager.addEntry(
        'user',
        existingFilesString,
        { documentId: "FILES_ID", replacementIfSuperseded: existingFilesString}
      );


      const workphase = workphaseName.toLowerCase().trim();

      if (workphase === "validation") {
        const urlCache = `# Cached URL Content:\n${getFormattedCacheContents()}`;
        thisTranscriptManager.addEntry(
          'user',
          urlCache,
          { documentId: "URL_CACHE", replacementIfSuperseded: urlCache}
        );
      }
      
      const newDiffBlock = generateDiffString(this.toolContext, true);
      thisTranscriptManager.addEntry(
        'user',
        newDiffBlock,
        { documentId: PROJECT_DIFF_ID, replacementIfSuperseded: newDiffBlock}
      );

      thisTranscriptManager.addEntry('user', projectDetailsString);

      if (i === 0) {
        thisTranscriptManager.addEntry('user', `\n\nYou are the first expert to join this conversation. Get started on completing the Specific Task.`);
      } else {
        thisTranscriptManager.addEntry('user', `\n\nYou are not the first persom to join this conversation. Here is has been said so far:`);
      }
    }

    const workphaseTaskSummaryPrompt = `An LLM agent is working on a project and it's taking a long time. It's about to start a new task and I need to summarize that task in a concise sentence that summarizes the work that's about to begin. The goal is to tell the user what's happening next but presented in the present tense, that will be inserted as the 'task description' in the following sentence displayed to the user: "I've created a Work Phase to collaborate on [Task Description]". The sentence should begin with a verb (Eg. 'planning', 'researching', 'developing', etc.). Your response should be fully grounded in the prompt I'm going to share. NEVER imagine, invent, or infer what work that will be done. Here is the prompt you should read to understand the work that will be done:\n${projectDetailsString}`;
    let workphaseTaskSummary = (await this.multiAgentGeminiClient.sendOneShotMessage(
      workphaseTaskSummaryPrompt,
      { model: DEFAULT_GEMINI_LITE_MODEL, signal: this.signal }
    ))?.text || '';
    workphaseTaskSummary = removeBacktickFences(workphaseTaskSummary);
    if (!workphaseTaskSummary.endsWith('.'))
      workphaseTaskSummary += '.';

    const formattedExpertList = formatExpertList(selectedExpertNames)
    this.updateLog(`# ${workphaseName} started with ${formattedExpertList}.`);
    this.updateProgressLog(`\n### ${workphaseName} Workphase\nAdded ${formattedExpertList} as collaborators.`);

    let hasWarnedTimeLow = false;
    let done = false;
    let turn = -1;
    let currentExpertIndex = -1;
 
    while (!done) {
      if (this.signal?.aborted) {
        this.updateLog('Work Phase received abort signal. Cancelling...');

        this.sendMessage({
          type: 'PROGRESS_UPDATE',
          message: '#### Cancelling Project\n\nThe Work Phase has received a cancellation request. Shutting down.'
        });

        // Perform any immediate cleanup here if necessary before breaking
        workPhaseResult = 'Work Phase cancelled by user.';
        done = true; // Set done to true to exit the loop
        // Do not call endWorkphase here, as it generates summaries which might be undesired on abort.
        break; 
      }

      const now = Date.now();
      if (this.toolContext.projectDeadlineMs && this.toolContext.gracePeriodMs) {
        const timeRemaining = this.toolContext.projectDeadlineMs - now;

        if (timeRemaining <= 0) {
          await this.updateLog('Hard time limit reached within Work Phase. Forcing exit.');
          this.updateProgressLog("#### Time Limit Reached. Forcing End of Work Phase.");
          done = true;
          return await this.endWorkphase();
        } 
        else if (timeRemaining <= this.toolContext.gracePeriodMs && !hasWarnedTimeLow) {
          hasWarnedTimeLow = true;
          const timeWarning = `CRITICAL WARNING: The project environment will shut down within the next 3 turns. You MUST immediately record the results of any experiments, and then return your best attempt at the result using @RETURN.`;
          
          this.addToEachExpertTranscript('user', timeWarning);
          await this.updateLog(`Soft time limit reached. Alerting Work Phase experts to wrap up.`);
          this.updateProgressLog(`\n#### System Alert\nTime running out. Forcing Work Phase completion.`);
        }
      }

      currentExpertIndex = (currentExpertIndex + 1) % this.experts.length;
      if (currentExpertIndex === 0) {
        turn++;
      }

      const currentExpertName = selectedExpertNames[currentExpertIndex];
      const currentExpert = this.experts[currentExpertIndex]
      this.toolContext.transcriptForContext = currentExpert.transcript;

      await this.updateLog(`### ${currentExpertName} (Turn #${turn})`);

      let updatedFaqString = "# Expert Answers to Frequently Asked Questions:\n";
      updatedFaqString += getFAQs();
      currentExpert?.transcript.replaceEntry(
        "FAQ_ID",
        updatedFaqString
      );

      currentExpert?.transcript.replaceEntry(
        "FILES_ID",
        `\n# Available editable text-based files:\n${getTaskRelevantFileDescriptions()}\n\nBinary Files Summary:\n${this.toolContext.binaryFileMap.size} binary files.`
      );

      const newDiffBlock = generateDiffString(this.toolContext, true);
      currentExpert?.transcript.replaceEntry(
        PROJECT_DIFF_ID,
        newDiffBlock
      );

      // Check for Overseer Feedback first
      const feedback = this.overseer?.peekPendingFeedback();
      if (feedback) {
        switch (feedback.action) {
          case 'GUIDE':
            // Check if this is Forced User Guidance. If so, we process it but DO NOT consume it,
            // allowing the Orchestrator to see it next turn and update the initial prompt.
            const shouldCommit = feedback.type !== GuidanceType.ForcedUserGuidance;

            if (shouldCommit) {
              this.overseer?.commitAndClearPendingFeedback(feedback); 
            }
            
            this.addToEachExpertTranscript('user', `**Overseer Guidance:**\nThe overseer has reviewed your work and provided a specific hint to help you succeed:\n${feedback.guidance}`);
            this.updateLog(`The overseer has provided guidance:\n${feedback.guidance}`, false);
            this.updateProgressLog(`\n#### Overseer\n${feedback.guidance}`);
            break;

          case 'CONTINUE':
            // Consume the feedback: This is for the WorkPhase only.
            this.overseer?.commitAndClearPendingFeedback(feedback);
            this.updateLog(`Overseer check-in:\n${feedback.reasoning}`, false);
            this.updateProgressLog(`\n#### Overseer\n${feedback.reasoning}`);
            break;

          case 'RESTART':
            // DO NOT CONSUME. Let Orchestrator handle it.
            this.updateLog('The overseer has decided to restart the project.', false);
            this.updateProgressLog(`\n#### Overseer\nThe Overseer has ordered a project restart. Abandoning Work Phase.`,);
            return { result: 'Overseer ordered a project restart.', retrospective: emptySummary };

          case 'ABANDON':
            // DO NOT CONSUME. Let Orchestrator handle it.
            this.updateLog('Overseer ordered ABANDON. Exiting WorkPhase.', false);
            this.updateProgressLog(`\n#### Overseer\nThe Overseer has decided to abandon the project. Abandoning Work Phase.`,);
            return { result: 'Overseer ordered a project abandon.', retrospective: emptySummary };
        }
      }

      if (turn > this.maxAllowedTurns + 1) {
        this.addToEachExpertTranscript('user', `You have run out of turns and MUST return a result. You must now provide your best response to try and solve the task you were assigned.`)
        await this.updateLog(`Work Phase turn limit reached.`);
        this.updateProgressLog("#### Soft Turn Limit Reached.");
      } 
      if (turn > this.maxAllowedTurns + 2) {
        done = true;
        await this.updateLog(`Hard Work Phase turn limit reached. Forced end of Work Phase.`);
        this.updateProgressLog("#### Hard Turn Limit Reached. Forcing End of Work Phase.");
        return await this.endWorkphase();
      }

      this.updateProgressLog(`\n#### ${currentExpertName} (Turn #${turn+1})`);

      const currentExpertResponse = await this.multiAgentGeminiClient.sendTranscriptMessage(
        currentExpert?.transcript,
        {
          model: currentExpert?.model,
          temperature: currentExpert?.inRoomTemperature,
          signal: this.signal
        }
      );
      let currentExpertResponseText = currentExpertResponse.text || '';
      currentExpertResponseText = await currentExpert?.transcript.cleanLLMResponse(currentExpertResponseText) || currentExpertResponseText;

      this.updateProgressLog(this.summarizeExpertUpdate(currentExpertResponseText));

      const responseUpdate = `${currentExpertName} said:\n${currentExpertResponseText}`;
      await this.updateLog(`${responseUpdate}`);
      this.addToEachExpertTranscript('user', responseUpdate, undefined, currentExpertIndex);

      // 1. Check for empty response.
      if (!currentExpertResponseText) {
        this.addToEachExpertTranscript('user', `Sorry, I was unable to respond. Please continue.`);
        continue;
      }

      // 2. Check for Tool Invocations
      const toolRequest = await parseToolRequest(currentExpertResponseText, await getAssetString('tool-prefix'), this.toolContext);
      if (typeof(toolRequest) === 'string') {
        await this.updateLog(`Tool identifier found: Parsing error: ${toolRequest}`);
        this.updateProgressLog("#### Tool Request Parsing Error")
        this.addToEachExpertTranscript('user', toolRequest);
        continue;
      } else if (toolRequest) {
        if (toolRequest?.toolName) {
          const tool = getTool(toolRequest.toolName);
          await this.updateLog(`Invoking '${tool?.displayName}' Tool`);
          this.updateProgressLog(`\n#### '${tool?.displayName}' Invoked`)
        }
        try {

          const toolResult = await withDeadline(
            executeTool(toolRequest.toolName, toolRequest.params, this.toolContext),
            this.toolContext.projectDeadlineMs!,
            this.signal
          );

          this.addToEachExpertTranscript('user', toolResult.result, { documentId: toolResult.transcriptReplacementID, replacementIfSuperseded: toolResult.transcriptReplacementString});
          let toolResponseLogString = toolResult.result;
          toolResponseLogString = replaceContentBetweenMarkers(toolResponseLogString, filePrefix, fileSuffix, logReplacementString);
          toolResponseLogString = replaceContentBetweenMarkers(toolResponseLogString, urlPrefix, urlSuffix, logReplacementString);
          await this.updateLog(`Tool Result:\n${toolResponseLogString}`);
        } catch (error: any) {
          const errorMessage = `Tool execution failed: ${error.message}`;
          this.addToEachExpertTranscript('user', errorMessage);
          await this.updateLog(errorMessage);
          this.updateProgressLog(`${errorMessage}`);
        }
        this.toolContext.overseer?.updateCurrentDiff(generateDiffString(this.toolContext, true));
        continue;
      }

      // 3. Check for RETURN
      if (/^\u0040RETURN/m.test(currentExpertResponseText)) {
        await this.updateLog(`Workphase is finished.`);
        done = true;
        const parts = currentExpertResponseText.split(/^\u0040RETURN/im);
        const resultString = parts.length > 1 ? parts.pop()?.trim() ?? undefined : undefined;
        this.updateProgressLog(`\n#### ${workphaseName} Work Phase Summary`)
        return await this.endWorkphase(resultString);
      }
    }
    if (this.signal?.aborted) {
      return { result: workPhaseResult, retrospective: undefined };
    }

    return await this.endWorkphase();
  }

  private addToEachExpertTranscript(speaker: string, content: string, options?: AddEntryOptions, exclude?: number) {
    for (let i = 0; i < this.experts.length; i++)
      if (!exclude || (exclude != i))
        this.experts[i].transcript.addEntry(speaker, content, options);
  }

  private async endWorkphase(lastLLMResponse?: string | undefined): Promise<{result: string; retrospective: string | undefined;}> {
    let workPhaseResult = lastLLMResponse ?? NO_RESULT_STRING;

    // Summarize the conversation from each expert's perspective
    const summarizeConverationMessage = await getAssetString(toKebabCase('summarize-converation-message'));
    this.addToEachExpertTranscript('user', summarizeConverationMessage);

    const summaries: string[] = [];
    for (let i = 0; i < this.experts.length; i++) {
      const expert = this.experts[i];
      try {
        const summaryResult = await this.multiAgentGeminiClient.sendTranscriptMessage(
          expert.transcript, 
          {
            model : expert.model,
            temperature: expert.inRoomTemperature,
            signal: this.signal
          });
        let expertSummary = `${expert.name}:\n`;
        expertSummary += summaryResult?.text || `--No summary provided--`;
        expertSummary = await expert.transcript.cleanLLMResponse(expertSummary);

        summaries.push(expertSummary);
      } catch (error: unknown) {
        this.updateLog(`Error getting retrospective from ${expert.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    let retrospective: string | undefined;
    if (summaries && summaries.length > 0) {
      const combinedRetrospective = summaries.join("\n\n").trim();

      const summarizeWorkphaseRetrospectivesPrompt = await getAssetString(toKebabCase('summarize-workphase-retrospectives'));

      const summarizeWorkphaseRetrospectivesPromptReplaced = await replaceRuntimePlaceholders(
        summarizeWorkphaseRetrospectivesPrompt, 
        {
          WorkphaseTask : this.task,
          ExpertRetrospectives : combinedRetrospective,
        }
      );

      retrospective = (await this.multiAgentGeminiClient.sendOneShotMessage(
        summarizeWorkphaseRetrospectivesPromptReplaced,
        { model: DEFAULT_GEMINI_FLASH_MODEL, signal: this.signal }
      ))?.text || emptySummary;
      retrospective = removeBacktickFences(retrospective ?? "");
      this.updateLog(`Workphase Summary:\n${retrospective}`);
    } else {
      this.updateLog(`No retrospectives received.`);
      retrospective = emptySummary;
    }

    return { result: workPhaseResult, retrospective: retrospective };
  }
}