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

import { DEFAULT_GEMINI_PRO_MODEL } from "../config/models.js";
import { GeminiClient } from "../services/geminiClient.js";
import { getAssetString, getExpertPrompt } from "../services/promptManager.js";
import { removeBacktickFences } from "../utils/markdownUtils.js";
import { OverseerFeedback, GuidanceType } from "./types.js";

const NO_DIFF_STRING = "---No diff information available---"

/**
 * The Overseer class is responsible for periodically reviewing a worklog
 * for a single client task and providing feedback.
 */
export class Overseer {
  private interval: number;
  private multiAgentGeminiClient: GeminiClient;
  private onFeedback: () => Promise<void>; // Internal callback for timer
  private worklog: string;
  private intervalId: NodeJS.Timeout | null;
  private isRunning: boolean;
  private isChecking: boolean;
  private feedbackHistory: OverseerFeedback[];
  private restartCount: number;
  private promptText: string;
  private pendingFeedback: OverseerFeedback | null;
  private currentDiff: string;
  private assumptions: string;

  private constructor(interval: number, preamble: string, assumptions: string, multiAgentGeminiClient: GeminiClient) {
    if (!interval) {
      throw new Error("Overseer requires an interval.");
    }
    this.interval = interval;

    // Initialize properties
    this.worklog = "";
    this.intervalId = null;
    this.isRunning = false;
    this.isChecking = false;
    this.feedbackHistory = [];
    this.restartCount = 0;
    this.pendingFeedback = null;
    this.promptText = preamble;
    this.multiAgentGeminiClient = multiAgentGeminiClient;
    this.currentDiff = NO_DIFF_STRING;
    this.assumptions = assumptions;

    // Bind the internal review function for setInterval
    this.onFeedback = async () => {
      this._performReview().then(feedback => {
      if (feedback) {
        this.pendingFeedback = feedback; // Store feedback, replacing any that hasn't been retrieved.
        console.log(`Overseer has generated new pending feedback.`);
      }}).catch(error => {
        console.error(`Error in Overseer's scheduled review:`, error);
      });
    };
  }

  /**
   * Returns the current pending feedback without clearing it or committing it to history.
   * This allows for "peeking" at the feedback before deciding to process it.
   * @returns {object|null} The feedback object that is pending, or null if there is none.
   */
  public peekPendingFeedback(): OverseerFeedback | null {
    return this.pendingFeedback;
  }

  /**
   * Atomically retrieves pending feedback, clears it, and commits it to the history.
   * This action signifies that the feedback has been "received" by the agent.
   * @param feedback The feedback object to commit. If null, the currently pending feedback is committed.
   * @returns {object|null} The feedback object that was processed and committed, or null if there was none.
   */
  public commitAndClearPendingFeedback(feedback?: OverseerFeedback): OverseerFeedback | null {
    const feedbackToCommit = feedback || this.pendingFeedback;
    this.pendingFeedback = null; // Clear pending feedback immediately.

    if (feedbackToCommit) {
      this.feedbackHistory.push(feedbackToCommit);

      if (feedbackToCommit.action === 'RESTART') {
        this.restartCount++;
      }
      console.log(`Feedback for client received and committed.`);
    }

    return feedbackToCommit;
  }

  /**
   * Adds a log entry to the internal worklog.
   * Note: This implementation only stores logs in-memory for the current session.
   * @param logEntry The string entry to add to the worklog.
   */
  public addLog(logEntry: string): void {
    const formattedLog = logEntry + "\n";
    this.worklog += formattedLog;
  }

  /**
   * Clears the current in-memory worklog, but preserves the feedback history and restart count.
   */
  public clearWorklog(): void {
    this.currentDiff = NO_DIFF_STRING;
    this.worklog = "";
    console.log(`Worklog cleared.`);
  }

  /**
   * Starts the periodic review process.
   */
  public start(): void {
    if (this.isRunning) return;
    console.log(`Overseer started with a ${this.interval / 1000}s interval.`);
    this.isRunning = true;
    this.intervalId = setInterval(this.onFeedback, this.interval);
  }

  /**
   * Stops the periodic review process.
   */
  public stop(): void {
    if (!this.isRunning) return;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
    this.isRunning = false;
    console.log(`Overseer stopped.`);
  }

  // Add this new public method to your Overseer class in overseer.ts
  public forceRestart(guidance: string, reasoning: string = "Restart triggered by agent tool."): void {
    if (this.pendingFeedback) {
      console.warn("Overseer `forceRestart` overwriting existing pending feedback.");
    }
    this.pendingFeedback = {
      action: 'RESTART',
      reasoning: reasoning,
      guidance: guidance,
      type: GuidanceType.ForcedUserGuidance
    };
    console.log(`Overseer restart was forced by an agent.`);
  }

  /**
   * Updates the current diff string held by the Overseer.
   * @param diffString The latest unified diff string.
   */
  public updateCurrentDiff(diffString: string): void {
    this.currentDiff = diffString || "---No changes detected---";
  }

  /**
   * Forces the Overseer to provide guidance to the agent.
   * @param guidance The guidance message to provide.
   * @param reasoning The reasoning for providing guidance (optional).
   */
  public forceGuidance(guidance: string, reasoning: string = "Guidance provided by user."): void {
    if (this.pendingFeedback) {
      console.warn("Overseer `forceGuidance` overwriting existing pending feedback.");
    }
    this.pendingFeedback = {
      action: 'GUIDE',
      reasoning: reasoning,
      guidance: guidance,
      type: GuidanceType.ForcedUserGuidance
    };
    console.log(`Overseer guidance was forced by an agent.`);
  }

  /**
   * Forces an immediate review by the Overseer.
   * @returns A promise that resolves with the feedback object, or null if no feedback was generated.
   */
  public async forceReview(): Promise<OverseerFeedback | null> {
    console.log(`Forcing an immediate Overseer review...`);
    return this._performReview();
  }

  /**
   * Performs the core review logic using an AI agent.
   * @returns A promise that resolves with the feedback object, or null if an error occurred or review is in progress.
   * @private
   */
  private async _performReview(): Promise<OverseerFeedback | null> {
    if (this.isChecking) {
      console.log("Overseer check is already in progress, skipping this invocation.");
      return null;
    }
    this.isChecking = true;
    try {
      let promptSections: string[] = [this.promptText];

      if (this.feedbackHistory.length > 0) {
        const historyHeader = `
**Overseer's Memory & Current State (Based on Received Feedback):**
- **Restart Attempts So Far:** ${this.restartCount}
- **Confirmed Feedback History (Oldest to Newest):**`;

        const historyLog = this.feedbackHistory.map((fb, index) => `
${index + 1}. **Action:** \`${fb.action}\`
- **Reasoning:** "${fb.reasoning}"
- **Guidance Provided:** ${fb.guidance ? `"${fb.guidance}"` : "None"}`).join('');
        promptSections.push(historyHeader + historyLog + "\n---");
      }

      promptSections.push(`
**Project-Scope Guidance:**
The following guidance has been provided to the Project Orchestrator and each Work Phase for guidance. They constitute standard preferences and best practices as long as they don't contradict anything in the Project Requirements. If there is any contradiction, the Project Definition is correct:
${await getAssetString('base-assumptions')}
${this.assumptions}`);
      
      promptSections.push(`**Current Project Diff:**\n\`\`\`\n${this.currentDiff}\n\`\`\`\n---`);

      promptSections.push(`**Worklog to Review:**\n\`\`\`\n${this.worklog}\n\`\`\`\n\nPlease provide your feedback in JSON format ONLY, with "action" (e.g., "CONTINUE", "RESTART", "PROVIDE_GUIDANCE"), "reasoning", and "guidance" (optional) fields.`);

      const fullPrompt = promptSections.join('\n');

      const responseText = (await this.multiAgentGeminiClient.sendOneShotMessage(
              fullPrompt,
              { model: DEFAULT_GEMINI_PRO_MODEL }
            ))?.text;

      console.log(`Overseer completed its review.`);

      // The LLM is instructed to return pure JSON.
      let feedback = undefined;
      if (responseText) { 
        const cleanResponseText = removeBacktickFences(responseText);
        feedback = JSON.parse(cleanResponseText);
      }

      // Basic validation of the feedback structure
      if (typeof feedback?.action !== 'string' || typeof feedback?.reasoning !== 'string') {
        throw new Error('Invalid feedback format: missing action or reasoning.');
      }
      
      // Ensure the type is set for standard Overseer guidance
      const overseerFeedback: OverseerFeedback = {
        ...feedback,
        type: GuidanceType.StandardOverseerGuidance
      };

      return overseerFeedback;

    } catch (error) {
      console.error(`Error during Overseer review:`, error);
      // Return null or re-throw based on desired error handling for scheduled tasks
      return null;
    } finally {
      this.isChecking = false;
    }
  }

  public static async createAndStart(interval: number, assumptions: string, multiAgentGeminiClient: GeminiClient): Promise<Overseer> {
    try {
      const { preamble } = await getExpertPrompt('overseer');
      const newOverseer = new Overseer(interval, preamble, assumptions, multiAgentGeminiClient);
      newOverseer.start();
      return newOverseer;
    } catch (error) {
      console.error(`Failed to load Overseer prompt: ${error}`);
      // Re-throw the error as we cannot create a valid instance
      throw new Error(`Could not create Overseer: ${error}`);
    }
  }
}