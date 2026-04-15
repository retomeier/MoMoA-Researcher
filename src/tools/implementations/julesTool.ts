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
  LARGE_FILE_LIMIT_KB,
  MultiAgentToolContext,
  MultiAgentToolResult,
  ToolParsingResult,
  VerbosityType } from '../../momoa_core/types.js';
import { applyDiff, isLockFile } from '../../utils/diffGenerator.js';
import { getAssetString, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { 
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_LITE_MODEL,
  DEFAULT_GEMINI_PRO_MODEL } from '../../config/models.js';
import { removeBacktickFences } from '../../utils/markdownUtils.js';
import { parsePatch } from 'diff';
import * as fs from 'node:fs/promises';
import * as path from 'node:path'; 
import { tmpdir } from 'node:os';
import { TranscriptManager } from '../../services/transcriptManager.js';
import { 
  addDynamicallyRelevantFile,
  getFileAnalysis, 
  removeFileEntry, 
  updateFileEntry 
} from '../../utils/fileAnalysis.js';
import { 
  formatActivityContent,
  JulesAPIService,
  JulesSessionState } from '../../services/julesService.js';
import { SimpleGit, simpleGit } from 'simple-git';
import { decodeGitBinaries } from '../../utils/gitUtils.js';

const MAX_PATCH_LENGTH = LARGE_FILE_LIMIT_KB*1000;
const JULES_POLLING_TIMEOUT_MINUTES = 10;
const JULES_POLLING_TIMEOUT_MS = JULES_POLLING_TIMEOUT_MINUTES * 60 * 1000;

const JULES_SCRATCHPAD_REPO_URL = ({ githubToken, repo }: { githubToken: string; repo: string }) => 
  `https://${githubToken}@github.com/${repo}.git`;

/**
 * A helper function to create a temporary git repository,
 * populate it with files, and push to a new branch.
 * @param context Tool use context containing secrets, branch info, scratchpad info, etc.
 * @param isFirstRun If true, all files from fileMap are added. Otherwise, only changed files are.
 * @returns The path to the temporary directory.
 */
async function sendFilesToGHScratpad(
  context: MultiAgentToolContext,
  isFirstRun: boolean
): Promise<void> {
  let {
    secrets,
    julesBranchName: branchName,
    fileMap,
    binaryFileMap,
    editedFilesSet: changedFilesSet,
  } = context;
  branchName ||= '';
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'jules-'));
  try {
    const git: SimpleGit = simpleGit(tempDir);
    if (!secrets.githubToken) {
      throw new Error('GITHUB_TOKEN environment variable not set. It is required for private repositories.');
    }

    let cloneUrl = JULES_SCRATCHPAD_REPO_URL({
      githubToken: secrets.githubToken,
      repo: secrets.githubScratchPadRepo,
    });
    await git.clone(cloneUrl, tempDir);

    if (isFirstRun) {
      await git.checkout(['-b', branchName]);
      for (const [filePath, content] of Array.from(fileMap.entries())) {
        const fullPath = path.join(tempDir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }
      for (const [filePath, base64Content] of Array.from(binaryFileMap.entries())) {
        const fullPath = path.join(tempDir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        const fileBuffer = Buffer.from(base64Content, 'base64');
        await fs.writeFile(fullPath, fileBuffer);
      }
    } else {
      await git.checkout(branchName);
      // Subsequent runs, add changed files
      for (const filePath of Array.from(changedFilesSet)) {
        const fullPath = path.join(tempDir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        
        if (fileMap.has(filePath)) {
          // It's a text file
          const content = fileMap.get(filePath) ?? '';
          await fs.writeFile(fullPath, content);
        } else if (binaryFileMap.has(filePath)) {
          // It's a binary file
          const base64Content = binaryFileMap.get(filePath) ?? '';
          const fileBuffer = Buffer.from(base64Content, 'base64');
          await fs.writeFile(fullPath, fileBuffer);
        }
      }
    }

    await git.add('./*');
    const commitMessage = isFirstRun ? 'Initial commit for Jules session' : 'Update files for Jules session';
    const commitResult = await git.commit(commitMessage);

    if (commitResult.commit) {
      if (isFirstRun) {
        await git.push('origin', branchName, ['--set-upstream']);
      } else {
        await git.push('origin', branchName);
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Implements the Jules Tool, providing functionality to create and manage a Jules session
 * for code modification tasks on a statically defined repository and branch.
 */
export const julesTool: MultiAgentTool = {
  displayName: "Jules Tool",
  name: 'JULES{',
  
  /**
   * Extracts the natural language request from the tool invocation string.
   * @param invocation The string used to invoke the tool.
   * @returns A ToolParsingResult with the extracted request.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    const request = invocation.slice(1).slice(0, -1).trim();
    if (!request) {
      return {
        success: false,
        error: `Invalid syntax for ${this.displayName}. A natural language request must be provided.`
      };
    }
    
    return {
      success: true,
      params: { request, forceAcceptFile: undefined }
    };
  },
  
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const { request, forceAcceptFile } = params;

    const updateLog = (message: string, includeInResponse: boolean = false) => {
      const logMessage = `${message}`;
      context.sendMessage(JSON.stringify({ status: 'WORK_LOG', message: `${logMessage}` }));
      if (includeInResponse) {
        context.overseer?.addLog(logMessage);
      }
      toolResponse += `\n${logMessage}`;
    };

    const updateProgress = (message: string | Promise<string>) => {
      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: message
      });
    }

    if (!context.secrets.julesApiKey)
      return { result: `Error: User has not provided a Jules API Key. Jules cannot be used.` }

    let branch: string;
    let toolResponse = "";

    if (!context.secrets.githubScratchPadRepo || !context.secrets.githubToken) {
      if (!context.secrets.githubScratchPadRepo)
        updateProgress("User hasn't provided a scratchpad. Jules requires access to a Github repo.");
      if (!context.secrets.githubToken)
        updateProgress("User hasn't provided a Github Access Token. Jules requires access to a Github repo.");

      return { result: `Error: User has not provided access to a Github repo connected to Jules.`}
    } else {
      try {
        const isFirstRun = !context.julesBranchName;
        if (isFirstRun) {
          const timestamp = new Date().getTime();
          context.julesBranchName = `jules-scratchpad/${timestamp}`;
          updateProgress(`Creating new GitHub scratchpad branch: ${context.julesBranchName}`)
          updateLog(`First Jules run this session. Creating new scratchpad branch: ${context.julesBranchName}`);

          await sendFilesToGHScratpad(context, true);
          updateLog(`Pushed all project files to scratchpad branch.`, true);
          updateProgress(`Pushed all project files to Github scratchpad branch.`)
        } else {
          if (context.julesBranchName) {
            updateLog(`Reusing scratchpad branch: ${context.julesBranchName}`);
            await sendFilesToGHScratpad(context, false);
            updateLog(`Pushed ${context.editedFilesSet.size} changed file(s) to scratchpad branch.`, true);
            updateProgress(`Pushed ${context.editedFilesSet.size} modified file(s) to ${context.julesBranchName}.`)
          } else {
            updateLog(`Failed to use scratchpad branch (not defined)`, true);
            updateProgress(`Failed to use scratchpad branch (not defined)`);
          }
        }
      } catch (error: any) {
        const errorMessage = `Error: Failed to prepare GitHub scratchpad branch: ${error.message}`;
        updateLog(errorMessage, true);
        updateProgress(errorMessage);
        return { result: errorMessage };
      }
    }

    branch = context.julesBranchName ?? '';
    if (!branch) {
      throw new Error("GitHub Scratchpad Branch was not created.");
    }

    // --- Session Creation / Reuse Logic ---
    const julesService = new JulesAPIService(context.secrets.julesApiKey);
    const processedActivityIds = new Set<string>();
    let finalMessage = `The Jules session completed, but no final message was provided.`;

    // 1. Get projects to find the source
    const projectsResult = await julesService.getProjects();
    if ('error' in projectsResult) {
        const errorMessage = `Failed to get Jules projects: ${projectsResult.error}`;
        updateLog(errorMessage, true);
        updateProgress(errorMessage)
        return { result: errorMessage };
    }

    // 2. Find the specific source corresponding to the scratchpad repository
    const [scratchOwner, scratchRepoName] = context.secrets.githubScratchPadRepo.split('/');
    const scratchSource = projectsResult.find(p => p.githubRepo.owner === scratchOwner && p.githubRepo.repo === scratchRepoName);

    if (!scratchSource) {
        const errorMessage = `Could not find a Jules source matching the scratchpad repo '${context.secrets.githubScratchPadRepo}'.`;
        updateLog(errorMessage, true);
        updateProgress(errorMessage);
        return { result: errorMessage };
    }
    updateLog(`Found matching source for scratchpad: ${scratchSource.name}`);
    updateLog(`Starting a new Jules session on scratchpad repo with branch '${branch}'.`);

    const promptTemplate = await getAssetString("jules-tool-prompt-template");
    const specificTask = `
**Specific Task:**
${request}
`.trim();

    const paddedRequest = await replaceRuntimePlaceholders(promptTemplate, {
      SpecificTask: specificTask
    });

    const sessionResult = await julesService.createSession(paddedRequest, scratchSource.name, branch);
    if ('error' in sessionResult) {
        const errorMessage = `Error: Failed to create Jules session: ${sessionResult.error}`;
        updateLog(errorMessage, true);
        updateProgress(errorMessage);
        return { result: errorMessage };
    }

    let session = sessionResult;
    context.julesSessionName = session.name;

    if (!session || 'error' in session) {
      updateProgress(`Failed to start a new Jules session.`)
      return { result: "Failed to initialize valid Jules session." };
    }
    
    const taskRequestPrompt = `
The Jules tool is used to perform specific software development tasks for an Agent. Please provide a concise summary of one or two sentences that describes what the Jules Tool has been asked to do.

The Jules Tool request:
\`\`\`
${specificTask}
\`\`\`

Your response must begin with, "Jules has been asked to"
    `.trim();
    const taskRequestSummary = (await context.multiAgentGeminiClient.sendOneShotMessage(
      taskRequestPrompt,
      { model: DEFAULT_GEMINI_LITE_MODEL }
    ))?.text || '';
    const cleanTaskRequestSummary = removeBacktickFences(taskRequestSummary);

    updateLog(`Session created successfully: ${session.url}`, true);
    updateProgress(`${cleanTaskRequestSummary} You can track progress at ${session.url}`);

    // --- Polling and Diff Application ---
    // Create a single, persistent transcript manager for this Jules Q&A session.
    const julesQnATranscript = new TranscriptManager({ 
        context: context.infrastructureContext 
      });
    const chatHistoryString = context.transcriptForContext.getTranscriptAsString(true, context.experts) || "--No Chat History Available--";
    const initialPreamble = `You are an expert developer helping an AI assistant named Jules.
Jules is working on a software development task and may ask questions.
Your responsibility is to provide clear, direct, and helpful responses based on the full context of the provided Project Conversation History.
Do not be conversational; provide only the necessary information to answer the questions. Answer the question as "full sentence answers" that incorporate the question into the response to ensure clarity.

You **MUST NOT** attempt to invoke tools. You **must** provide your response to Jules in a single response. 

---PROJECT CONVERSATION HISTORY---
${chatHistoryString}
------------------------------------

You will now receive questions from Jules.`;
    julesQnATranscript.addEntry('user', initialPreamble);

    let failureReason: string | null = null;
    let lastUpdateTime = Date.now();

    let fullJulesLog: string[] = [];

    // Create a set to track which message IDs we have actually replied to
    // This prevents replying to the same question twice if the state doesn't update instantly
    const repliedActivityIds = new Set<string>();

    const latestPatchesByFile = new Map<string, string>();
    const latestBinaryByFile = new Map<string, string>();

    while (session.state !== JulesSessionState.COMPLETED && session.state !== JulesSessionState.FAILED) {
      const TIMEOUT_LOG_MESSAGE = `Jules session timed out after ${JULES_POLLING_TIMEOUT_MINUTES} minutes of unresponsiveness.`;
      if (Date.now() - lastUpdateTime > JULES_POLLING_TIMEOUT_MS) {
        updateLog(TIMEOUT_LOG_MESSAGE, true);
        updateProgress(TIMEOUT_LOG_MESSAGE);
        fullJulesLog.push(TIMEOUT_LOG_MESSAGE);
        failureReason = 'The session timed out due to Jules inactivity.';
        break;
      }

      if (context.signal?.aborted) {
        updateLog('Received abort signal. Halting Jules session monitoring.', true);
        updateProgress('Received user cancellation signal. Halting Jules session.');
        fullJulesLog.push("Jules session was cancelled by the user.");
        return { result: 'Jules session was cancelled by the user.' };
      }

      await new Promise(resolve => setTimeout(resolve, 10000));

      // Update session state safely
      const sessionUpdate = await julesService.getSession(session.name);
      if ('error' in sessionUpdate) {
          updateLog(`Warning: Could not update session state: ${sessionUpdate.error}`);
          // Continue loop with old session state, hoping next poll succeeds
      } else {
          session = sessionUpdate;
      }

      const activitiesResult = await julesService.listActivities(session.name);
      if ('error'in activitiesResult) {
          updateLog(`Warning: Could not list activities: ${activitiesResult.error}`);
          continue;
      }

      // We check for the waiting state explicitly, outside the activity processing loop.
      // This ensures that even if we processed the message activity in a previous tick 
      // (when state was RUNNING), we still catch the need to reply here.
      if (session.state === JulesSessionState.AWAITING_USER_FEEDBACK) {
        // Find the most recent agent message
        let lastQuestionActivity = null;
        // Iterate backwards to find the latest message
        for (let i = activitiesResult.length - 1; i >= 0; i--) {
          if (activitiesResult[i].agentMessaged) {
            lastQuestionActivity = activitiesResult[i];
            break;
          }
        }

        // If we found a question and haven't replied to this specific ID yet
        if (lastQuestionActivity && !repliedActivityIds.has(lastQuestionActivity.id)) {
            const message = lastQuestionActivity.agentMessaged!.agentMessage;
            
            updateLog(`Jules is requesting feedback: "${message}"`, true);
            updateProgress(`Received a question from Jules:\n\`\`\`\`\n${message}\n\`\`\`\``);
            fullJulesLog.push(message);
            
            // Update transcript and generate LLM response
            julesQnATranscript.addEntry('user', `Question from Jules:\n"${message}"`);

            const llmResponse = await context.multiAgentGeminiClient.sendTranscriptMessage(
              julesQnATranscript,
              { model: DEFAULT_GEMINI_FLASH_MODEL }
            );
            const llmResponseText = llmResponse?.text
              || "I am not sure how to answer that. Please proceed with your best judgment.";

            julesQnATranscript.addEntry('model', llmResponseText);
            const cleanedResponse = removeBacktickFences(llmResponseText);

            updateLog(`Responded to Jules with: "${cleanedResponse}"`, true);
            updateProgress(`Told Jules: "${cleanedResponse}"`);
            fullJulesLog.push(`User Answer: "${cleanedResponse}"`);
            
            await julesService.postUserMessage(session.name, cleanedResponse);

            repliedActivityIds.add(lastQuestionActivity.id);
            processedActivityIds.add(lastQuestionActivity.id);
            
            lastUpdateTime = Date.now();
            
            continue; 
        }
      }

      for (const activity of activitiesResult) {
        if (processedActivityIds.has(activity.id)) continue;
        
        lastUpdateTime = Date.now(); 
        processedActivityIds.add(activity.id);

        // 1. Capture critical state changes
        if (activity.sessionFailed) {
          failureReason = activity.sessionFailed.reason;
          const failureReasonLogString = `This Jules session has failed: ${failureReason}`;
          updateProgress(`This Jules session has failed: ${failureReason}`);
          fullJulesLog.push(failureReasonLogString);
        }

        if (activity.agentMessaged) {
           finalMessage = activity.agentMessaged.agentMessage;
        }

        // 2. Format the activity using the new helper
        const formattedLogPromise = formatActivityContent(activity, VerbosityType.AISummarize, context.multiAgentGeminiClient, request);

        formattedLogPromise.then(msg => {
          fullJulesLog.push(msg);
          updateLog(msg, includeInResponse);
        });

        // 3. Determine visibility (Filtering noisy logs from immediate user output)
        let includeInResponse = true;
        if (activity.progressUpdated) {
            const title = activity.progressUpdated.title || "";
            if (title.startsWith("Code reviewed")) {
              includeInResponse = false;
            }
        }
        
        // Always update the log with the formatted content
        updateProgress(formattedLogPromise);
      }
    }

    // Diff for Log Summary
    let patchString = "---No files changed---";
    const allActivities = await julesService.listActivities(session.name);
    if ('error' in allActivities) {
    } else {
      allActivities.forEach(activity => {
        activity.artifacts?.forEach(artifact => {
          if (artifact.media) {
            // In a real-world scenario, you'd need a way to determine the filename.
            // If Jules doesn't provide it in the artifact, we check the activity description.
            const filename = activity.description.split(' ').pop(); // Logic to extract path
            if (filename) {
              latestBinaryByFile.set(filename, artifact.media.data);
            }
          }
          if (artifact.changeSet?.gitPatch?.unidiffPatch) {
            patchString = artifact.changeSet.gitPatch.unidiffPatch;
          }
        })
      });
    }

    let summarizerPrompt = await getAssetString("log-summarizer");
    summarizerPrompt = await replaceRuntimePlaceholders(summarizerPrompt, {
      LogContent: fullJulesLog.join("\n"),
      UnifiedDiff: patchString,
    })
    const summarizedResponse = (await context.multiAgentGeminiClient.sendOneShotMessage(
      summarizerPrompt,
      { model: DEFAULT_GEMINI_FLASH_MODEL }
    ))?.text || '';
    const cleanSummary = removeBacktickFences(summarizedResponse);

    // // Check for failure from either the session itself or our timeout
    // if (session.state !== JulesSessionState.COMPLETED || failureReason) {
    //   const reason = failureReason || 'Unknown reason.';
    //   return { result: `Jules session failed: ${reason}\n**Jules Log Summary:**\n${cleanSummary}` };
    // }

    // updateLog('Jules Session completed. Starting analysis of provided diff...');
    // if ('error' in allActivities) {
    //   return { result: `Session completed, but failed to retrieve final activities: ${allActivities.error}\n\n**Jules Log Summary:**\n${cleanSummary}` };
    // }
    
    // Check for failure from either the session itself or our timeout
    const isFailedSession = session.state !== JulesSessionState.COMPLETED || failureReason;
    if (isFailedSession) {
      const reason = failureReason || 'Unknown reason.';
      updateLog(`Jules session ended prematurely: ${reason}. Attempting to recover any generated files...`, true);
      updateProgress(`Jules session ended prematurely: ${reason}. Recovering generated files.`);
    } else {
      updateLog('Jules Session completed. Starting analysis of provided diff...');
    }

    if ('error' in allActivities) {
      return { result: `Session finished, but failed to retrieve final activities: ${allActivities.error}\n\n**Jules Log Summary:**\n${cleanSummary}` };
    }

    allActivities.forEach(activity => {
      activity.artifacts?.forEach(artifact => {
        if (artifact.changeSet?.gitPatch?.unidiffPatch) {
          const patchString = artifact.changeSet.gitPatch.unidiffPatch;

          // Split the full patch string into individual, per-file patch strings.
          // Each new file patch starts with "diff --git".
          const filePatches = patchString.split('\ndiff --git');

          for (let i = 0; i < filePatches.length; i++) {

            let filePatchString = filePatches[i];
            
            if (i > 0) {
              filePatchString = 'diff --git' + filePatchString;
            }


            if (filePatchString.includes('GIT binary patch')) {
              const match = filePatchString.match(/diff --git a\/.*? b\/(.*?)\n/);
              if (match && match[1]) {
                const filename = match[1].trim();
                
                // Store the raw patch. We can't base64 decode it yet, but this registers it
                // so the LLM sees it and your ACCEPT logic triggers properly.
                latestBinaryByFile.set(filename, filePatchString);
                latestPatchesByFile.set(filename, filePatchString);
              }
              continue; // Skip text diff parsing for this file
            }

            // Now, parse this *individual* file patch to get its filename
            const individualParsedPatches = parsePatch(filePatchString);
            if (individualParsedPatches.length === 0) {
              continue;
            }

            const patchObject = individualParsedPatches[0];
            const isDeletion = patchObject.newFileName === '/dev/null';
            const filename = (isDeletion
              ? patchObject.oldFileName?.replace(/^a\//, '')
              : patchObject.newFileName?.replace(/^b\//, '')) as string;

            if (filename) {
              // Store the *individual file's patch string* against its filename
              latestPatchesByFile.set(filename, filePatchString);
            }
          }
        }
      });
    });

    const fullDiff = Array.from(latestPatchesByFile.values()).join('\n');

    let diffForReview = '';
    latestPatchesByFile.forEach((patch, filename) => {
      if (latestBinaryByFile.has(filename)) {
        // Hide the unreadable binary patch string to save context tokens
        diffForReview += `diff --git a/${filename} b/${filename}\n`;
        diffForReview += `@@ -0,0 +1 @@\n`;
        diffForReview += `+ [Binary files hidden during review to save context]\n`;
      } else if (isLockFile(filename) || patch.length > MAX_PATCH_LENGTH) {
        // Manually construct a redacted patch for display purposes
        diffForReview += `diff --git a/${filename} b/${filename}\n`;
        diffForReview += `--- a/${filename}\n`;
        diffForReview += `+++ b/${filename}\n`;
        diffForReview += `@@ -0,0 +1 @@\n`;
        diffForReview += `+ [Large file changes hidden during review to save context]\n`;
      } else {
        diffForReview += patch + '\n';
      }
    });

    if (!fullDiff.trim()) {
      updateProgress(finalMessage.trim());

      const resultString = `
**Final response from Jules:**
${finalMessage.trim()}

**Jules updates during execution:**
${toolResponse.trim()}

**Jules Log Summary:**
${cleanSummary.trim()}

**File Changes:**
Note that Jules operates in a sandboxed environment, only a successfully applied diff can persist Jules changes to the project files. Any other changes to the Jules environment described in the log but not reflected in a successfully applied diff will NOT be perisisted.
**No files were changed during this Jules session.** `.trim();
      return { result: resultString };
    }

    updateLog('Asking LLM to review the generated diff from Jules...');

    const binaryFileList = Array.from(latestBinaryByFile.keys()).join('\n') || 'None';
    
    const verificationPrompt = `A sophisticated AI software development agent named Jules was given the following task based on our conversation:
--- Jules Assigned Task ---
${request}
---

This is the conversation history you and I had that led to us assigning that task to Jules:
--- CONVERSATION HISTORY ---
${context.transcriptForContext.getTranscriptAsString(true, context.experts)}
---------------------------

Jules has now completed the task and produced the following unified diff. Review this diff in the context of our conversation that led to the specific task Jules was asked to complete. Your job is to act as a quality gate. Decide if these changes should be applied to the project. Jules is a powerful software development agent, and it may make more changes than it was specifically asked to do. This is good! Doing more work than required isn't a failure, but Jules works in a Sandbox and doesn't have the same context you do, so all of its recommended changes must be carefully reviewed to ensure they are still within scope of our goal and don't introduce unwanted changes. Specifically identify and do NOT accept any files that were **not** requested (such as artifacts from running builds or tests, that don't need to be applied to the project files. 

You MUST NOT accept artifacts that consist of test results (Eg. \`Test_Results.txt\`). These are useful and often necessary for understanding test success and failures, but they should NEVER be added to the proejct files .

Consider all files on their merits, considering the conversation history context, even if they weren't specifically requested.

Please review all of Jule's suggested changes, along with the Jules Log that will help explain its choices. 

--- JULES' PROPOSED DIFF ---
${diffForReview}

--- JULES' PROPOSED BINARY CHANGES ---
${binaryFileList}

----------------------------

Based on your review, you must make a decision. Choose one of three options:
1.  **ACCEPT_ALL**: The entire diff is correct, solves the taks, helps solve our task, and should be applied to the project files.
2.  **REJECT_ALL**: The entire diff is incorrect, out of scope, or harmful and should be rejected.
3.  **ACCEPT_PARTIAL**: Only the changes for *some* of the files are correct and should be applied. You MUST provide the \`files_to_apply\` that you have decided should be applied. This element must contain ONLY the files whose changes you wish to accept and apply.

You MUST respond in the following JSON format. Do not add any other text or explanations outside of the JSON structure.

{
  "decision": "ACCEPT_ALL" | "REJECT_ALL" | "ACCEPT_PARTIAL",
  "reasoning": "A brief explanation for your decision.",
  "files_to_apply": [
    "path/to/file1.ts",
    "path/to/file2.js"
  ]
}
`;

    const verificationResponseText = (await context.multiAgentGeminiClient.sendOneShotMessage(
      verificationPrompt,
      { model: DEFAULT_GEMINI_PRO_MODEL }
    ))?.text || '';
    const cleanedVerificationResponse = removeBacktickFences(verificationResponseText);

    let diffToApply = '';
    let verificationReasoning = "No reasoning provided.";
    let verificationResult;

    let changesApplied = false;
    const allChangedFiles = new Set<string>(); 

    try {
      verificationResult = JSON.parse(cleanedVerificationResponse);
      verificationReasoning = verificationResult.reasoning || verificationReasoning;

      let decision = verificationResult.decision.trim();
      const filesToApply = verificationResult.files_to_apply || [];


      if (forceAcceptFile && latestPatchesByFile.has(forceAcceptFile)) {
        if (decision === 'REJECT_ALL') {
          decision = 'ACCEPT_PARTIAL';
          verificationReasoning += `\n(System override: Forced application of ${forceAcceptFile})`;
        }
        filesToApply.push(forceAcceptFile);
      }

      // Text Files (Filter out binary patches to prevent applyDiff errors)
      if (decision === 'ACCEPT_ALL') {
        const textPatches: string[] = [];
        latestPatchesByFile.forEach((patch, filename) => {
          if (!latestBinaryByFile.has(filename)) {
            textPatches.push(patch);
          }
        });
        diffToApply = textPatches.join('\n');
        updateLog(`Applying the full text Diff`);
        updateProgress(`Accepting all Jules generated file changes.`);
      } else if (decision === 'ACCEPT_PARTIAL') {
        updateLog(`Files to Apply: ${JSON.stringify(filesToApply)}`);
        const partialPatches: string[] = [];
        for (const filename of filesToApply) {
          if (latestPatchesByFile.has(filename) && !latestBinaryByFile.has(filename)) {
            partialPatches.push(latestPatchesByFile.get(filename)!);
          }
        }
        diffToApply = partialPatches.join('\n');
        updateProgress(`Accepting some Jules generated file changes.`);
        if (!diffToApply.trim() && filesToApply.length > 0) {
          updateLog('LLM decided to accept partial diff, mostly binary files.', true);
        }
      } else { 
        diffToApply = ''; 
        updateLog('LLM rejected the entire diff. No changes will be applied.', true);
        updateProgress('Rejecting all Jules generated file changes.')
      }

      // Binary files
      let binaryFilesToApply: string[] = [];

      if (decision === 'ACCEPT_ALL') {
        // If all changes are accepted, we want every binary file Jules produced
        binaryFilesToApply = Array.from(latestBinaryByFile.keys());
      } else if (decision === 'ACCEPT_PARTIAL') {
        // If partial, filter the LLM's requested files to only those that are actually binary
        const requestedFiles = verificationResult.files_to_apply || [];
        binaryFilesToApply = requestedFiles.filter((filename: string) => latestBinaryByFile.has(filename));
      }

      // 2. Persist the accepted binary files
      if (binaryFilesToApply.length > 0) {
        // 1. Gather the raw patches for ONLY the accepted files
        const patchesToApply = binaryFilesToApply.map(f => latestBinaryByFile.get(f)!);
        
        // 2. Decode them via our temporary directory helper
        updateLog(`Decoding ${binaryFilesToApply.length} accepted binary file(s)...`);
        const decodedMap = await decodeGitBinaries(patchesToApply, binaryFilesToApply);

        // 3. Persist the clean base64 data to the project context
        for (const filename of binaryFilesToApply) {
          const base64Content = decodedMap.get(filename);
          
          if (!base64Content) {
            updateLog(`Warning: Failed to decode binary file ${filename}`, true);
            continue;
          }
          
          // Move into the binary map
          context.binaryFileMap.set(filename, base64Content);
          
          // Ensure it's removed from the text map (prevents diffing errors later)
          context.fileMap.delete(filename); 
          
          // Track the changes for context and syncing
          context.editedFilesSet.add(filename);
          allChangedFiles.add(filename);
          addDynamicallyRelevantFile(filename);
          
          // Update the file analysis metadata
          await updateFileEntry(filename, context.fileMap, undefined, {
            filename: filename,
            description: `[Binary File modified/created by Jules]`,
            relatedFiles: '',
          });
        }
        
        changesApplied = true;
      }
    } catch (error: any) {
      updateProgress(`Failed to parse diff verification response from LLM: ${error.message}`);
      updateLog(`Failed to parse diff verification response from LLM: ${error.message}. Rejecting all changes as a safety measure.`, true);
      verificationReasoning = `Could not apply changes due to an internal error while parsing the review decision. The LLM's raw response was: ${cleanedVerificationResponse}`;
      diffToApply = '';
    }

    let finalResultString = '';

    if (diffToApply.trim()) {
      const applyResult = applyDiff(context.fileMap, diffToApply);

      if (applyResult.success && applyResult.changes) {
        changesApplied = true;
        
        // 1. Handle Deletions
        for (const filename of applyResult.changes.deleted) {
          context.editedFilesSet.add(filename);
          allChangedFiles.add(filename);
          addDynamicallyRelevantFile(filename);
          removeFileEntry(filename); // Update analysis metadata
        }

        const handleLargeFile = async (filename: string, baseDescription: string) => {
          const content = context.fileMap.get(filename);
          // Check if content exists and exceeds limit (100KB)
          if (content && Buffer.byteLength(content, 'utf8') > (LARGE_FILE_LIMIT_KB * 1024)) {
              // Move to Binary Map
              context.binaryFileMap.set(filename, Buffer.from(content).toString('base64'));
              context.fileMap.delete(filename); // Remove from text map (Hides from Diff)
              
              // Update Analysis
              await updateFileEntry(filename, context.fileMap, undefined, {
                filename: filename,
                description: `${baseDescription} (Large Text Saved with Binary Files)`,
                relatedFiles: '',
              });
              return true;
          }
          return false;
        }
        
        // 2. Handle Creations
        for (const filename of applyResult.changes.created) {
          context.editedFilesSet.add(filename);
          allChangedFiles.add(filename);
          addDynamicallyRelevantFile(filename);
          // Check size before default update
          const isLarge = await handleLargeFile(filename, 'New file created by Jules.');
          if (!isLarge) {
              await updateFileEntry(filename, context.fileMap, undefined, {
                filename: filename,
                description: 'New file created by Jules agent.',
                relatedFiles: '',
              });
          }
        }
        
        // 3. Handle Modifications
        for (const filename of applyResult.changes.modified) {
          context.editedFilesSet.add(filename);
          allChangedFiles.add(filename);
          addDynamicallyRelevantFile(filename);
          // Update analysis metadata for modified file
          // Check size before default update
          const isLarge = await handleLargeFile(filename, '[Modified by Jules]');

          if (!isLarge) {
              const analysis = getFileAnalysis(filename) || { filename };
              analysis.description = `[Modified by Jules] ${analysis.description || ''}`.trim();
              analysis.relatedFiles = ''; 
              if (context.binaryFileMap.has(filename))
                analysis.description = `[Binary File] ${analysis.description}`;
              await updateFileEntry(filename, context.fileMap, undefined, analysis);
          }
        }
        
        // 4. Handle Renames (using logic from your moveFolderTool)
        for (const rename of applyResult.changes.renamed) {
          context.editedFilesSet.add(rename.from);
          context.editedFilesSet.add(rename.to);
          allChangedFiles.add(rename.from);
          allChangedFiles.add(rename.to);

          addDynamicallyRelevantFile(rename.from);
          addDynamicallyRelevantFile(rename.to);
          
          // Update analysis metadata for rename
          const sourceAnalysis = getFileAnalysis(rename.from);
          removeFileEntry(rename.from);
          
          if (sourceAnalysis) {
            sourceAnalysis.filename = rename.to;
            sourceAnalysis.relatedFiles = '';
            sourceAnalysis.description = `[Moved from ${rename.from} by Jules] ${sourceAnalysis.description || ''}`.trim();
            await updateFileEntry(rename.to, context.fileMap, undefined, sourceAnalysis);
          } else {
            // No source analysis, treat as new file
            await updateFileEntry(rename.to, context.fileMap, undefined, {
              filename: rename.to,
              description: `New file created by Jules from ${rename.from}.`,
              relatedFiles: '',
            });
          }
        }
      } else {
        updateLog(`Failed to apply the reviewed diff: ${applyResult.error}`);
        updateProgress(`Failed to apply the diff: ${applyResult.error}`);
        verificationReasoning += `\n\nNote: An error was encountered when trying to apply the reviewed changes: ${applyResult.error}`;
      }
    }

    if (allChangedFiles.size > 0 && context.transcriptsToUpdate) {
      allChangedFiles.forEach(filename => {
        context.transcriptsToUpdate?.forEach(transcript => {
            transcript.supersedeEntry(filename);
        });
      });
    }

    if (changesApplied) {
      const changedFilesList = Array.from(allChangedFiles).join(', ') || 'none';
      updateLog(`Successfully applied reviewed changes to: ${changedFilesList}`);
      updateProgress(`Incorporated the following files into the project: ${changedFilesList}`);
    }

    // Construct the final message based on the outcome.
    let appliedDiffMessage = '';
    if (changesApplied) {
       // Re-generate diffForReview based on EXACTLY what was applied.
       // This uniformly handles ACCEPT_ALL, ACCEPT_PARTIAL, and ensures the log matches reality.
       diffForReview = '';
       
       // Iterate over the original patches map to maintain a standard diff order.
       latestPatchesByFile.forEach((patch, filename) => {
          // Only include this file in the final log if it was actually changed
          if (allChangedFiles.has(filename)) {
            if (latestBinaryByFile.has(filename)) {
              diffForReview += `diff --git a/${filename} b/${filename}\n@@ -0,0 +1 @@\n+ [Binary file successfully applied]\n`;
            } else if (isLockFile(filename) || patch.length > MAX_PATCH_LENGTH) {
              diffForReview += `diff --git a/${filename} b/${filename}\n@@ -0,0 +1 @@\n+ [Large file changes successfully applied. Changes hidden to save context]\n`;
            } else {
              diffForReview += patch + '\n';
            }
          }
       });
       appliedDiffMessage = `---Start of Diff---\n${diffForReview}\n---End of Diff---`;
    } else {
      appliedDiffMessage = `\n\n---No changes were applied to the project files.---`;
    }

    const sessionCompletionStatus = isFailedSession 
      ? `Jules session ended prematurely (${failureReason || 'timeout'}), but generated code changes have been recovered, reviewed, and applied.`
      : `Jules has successfully completed the assigned task, and has generated code changes that have been reviewed and applied.`;
      
    finalResultString = `
${sessionCompletionStatus}

**Jules Log Summary:**
${cleanSummary.trim()}

**File Changes:**
Note that Jules operates in a sandboxed environment, only a successfully applied diff can persist Jules changes to the project files. Any other changes to the Jules environment described in the log but not reflected in a successfully applied diff will NOT be perisisted.
  
**File Review Decision:**
${verificationResult?.decision || "REJECT_ALL"}
${verificationReasoning}

**The following diff has been applied to the project files:**
\`\`\`\`
${appliedDiffMessage}
\`\`\`\`
`.trim();

    return { result: finalResultString };
  },
};