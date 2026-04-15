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

import { randomUUID } from "crypto";
import pkg from 'firebase-admin';
const { credential } = pkg;
import { ServiceAccount } from "firebase-admin";
import { AppOptions, initializeApp } from "firebase-admin/app";
import { getDatabase, OnDisconnect } from "firebase-admin/database";
import fs from "fs";
import { isBinaryFileSync } from "isbinaryfile";
import { Config, DEFAULT_GEMINI_EMBEDDING_MODEL } from "./config/config.js";
import { ProjectAnalysisResult } from "./momoa_core/types.js";
import { Orchestrator } from "./momoa_core/orchestrator.js";
import {
  FileChunkData,
  HistoryItem,
  IncomingAction,
  InitialRequestData,
  OutgoingMessage,
  ServerMode,
  SESSION_ROOT_PATH,
  PROJECT_ROOT_PATH,
  ProjectMetadata,
} from "./shared/model.js";
import { deferred } from "./utils/promises.js";
import { generateSessionTitle } from "./utils/sessionTitleGenerator.js";
import { cloneRepoIntoMemory } from "./utils/gitUtils.js";
import { resolveProjectSpecification } from "./utils/projectSpecResolver.js";
import { AuthType } from "./services/contentGenerator.js";
import { fileURLToPath } from 'url';
import path from 'path';
import { ProgressQueue } from "./utils/progressQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// firebase config
let appOptions: AppOptions = {
  databaseURL: "https://threeplabs-default-rtdb.firebaseio.com/",
};
if (process.env.NODE_ENV === "development") {
  const sa = fs.readFileSync(
    path.resolve(__dirname, "../.firebase-service-account.json"),
    "utf8"
  );
  appOptions.credential = credential.cert(JSON.parse(sa) as ServiceAccount);
} else {
  // in prod, use ADC
}

const app = initializeApp(appOptions);
const db = getDatabase(app);

// Info on running sessions
type RunningSession = {
  sessionId: string;
  abort: AbortController;
  bus: EventTarget;
  pendingTask?: InitialRequestData;
  runner?: Orchestrator;
  projectId?: string;
  mode?: ServerMode;
};

const runningSessions: Map<string, RunningSession> = new Map();

const runnerInstanceId = randomUUID();

const SERVER_MAX_DURATION_MS = 55 * 60 * 1000;
const SERVER_GRACE_PERIOD_MS = 5 * 60 * 1000;

export async function runSession(
  sessionId: string,
  takeOverIfActive = false
): Promise<void> {
  if (runningSessions.has(sessionId)) {
    console.log(`Session ${sessionId} is already running.`);
    return;
  }

  let sessionRef = db.ref(SESSION_ROOT_PATH).child(sessionId);
  let runnerRef = sessionRef.child("metadata/runnerInstanceId");
  let activeRunnerInstanceId = await runnerRef.get();

  // check if another process is actively working on this session, and if so, exit
  if (!takeOverIfActive && activeRunnerInstanceId.exists()) {
    console.log(
      `Session ${sessionId} is already being handled by another runner instance.`
    );
    return;
  }

  let sessionCompleteDeferred = deferred<void>();

  let session: RunningSession = {
    abort: new AbortController(),
    bus: new EventTarget(),
    sessionId,
  };

  runningSessions.set(sessionId, session);

  // set ourselves as the active runner for this session, and when this process exits, clear the
  // active runner info for this session... this also handles reconnections
  let disc: OnDisconnect | undefined;
  db.ref(".info/connected").on("value", (snapshot) => {
    let connected = !!snapshot.val();
    if (connected) {
      runnerRef.set(runnerInstanceId);
      disc?.cancel();
      disc = runnerRef.onDisconnect();
      disc.set(null);
    }
  });

  // listen for incoming messages (also look at all pending actions on first subscribe)
  let actionQueueRef = sessionRef.child("actionQueue");
  actionQueueRef.on("child_added", async (snapshot) => {
    const action = snapshot.val();
    handleIncomingMessage(sessionId, action);
    actionQueueRef.child(snapshot.key!).remove();
  });

  let tornDown = false;
  let teardown = (reason: string) => {
    if (tornDown) return;
    console.log(`Session ${sessionId} cleaning up because: ${reason}`);
    tornDown = true;
    runningSessions.delete(sessionId);
    disc?.cancel();
    disc = undefined;
    sessionCompleteDeferred.resolve();
    runnerRef.set(null);
  };

  session.bus.addEventListener("sessionComplete", () => teardown("Completed"));
  session.abort.signal.addEventListener("abort", () => {
    sessionRef.child("metadata").update({ status: "failed" });
    sendMessage(
      sessionId,
      JSON.stringify({
        status: "ERROR",
        message: "Session aborted.",
      })
    );
    teardown("Aborted");
  });

  // we must block until the session is complete
  return sessionCompleteDeferred.promise;
}

/**
 * Sends a message to a specific client.
 * @param {string} sessionId - The session ID to send the message to.
 * @param {string} message - The message payload to send.
 */
function sendMessage(sessionId: string, message: string): void {
  let sessionRef = db.ref(SESSION_ROOT_PATH).child(sessionId);
  let parsed = JSON.parse(message) as OutgoingMessage;
  sessionRef.child("history").push({
    ...parsed,
    timestamp: Date.now(),
    runnerInstanceId,
  } satisfies HistoryItem);
  if (parsed.status === "COMPLETE_RESULT") {
    sessionRef
      .child("metadata")
      .update({ modifiedAt: Date.now(), status: "complete" });
    sessionRef.child("result").set({
      ...parsed,
      timestamp: Date.now(),
      runnerInstanceId,
    });
    const session = runningSessions.get(sessionId);
    // Check if this is an Analyzer session and has a projectId
    if (session && session.mode === ServerMode.ANALYZER && session.projectId) {
      // Extract the result from the message payload
      const result = (parsed as any).data?.result;
      
      if (result) {
        const metadataRef = db.ref(PROJECT_ROOT_PATH)
          .child(session.projectId)
          .child("metadata");

        // Check if the result is a structured ProjectAnalysisResult object
        if (typeof result === 'object' && result.title && result.description && result.spec) {
          const analysisResult = result as ProjectAnalysisResult;
          console.log(`[Server] Automatically updating metadata and spec for Project ${session.projectId}`);
          
          metadataRef
            .update({
              title: analysisResult.title,
              description: analysisResult.description,
              spec: analysisResult.spec,
            })
            .catch(err => console.error(`[Server] Failed to update project metadata: ${err}`));

        // Fallback for old string-only spec result
        } else if (typeof result === 'string') {
          console.log(`[Server] Automatically updating spec for Project ${session.projectId} (string fallback)`);
          metadataRef
            .update({ spec: result })
            .catch(err => console.error(`[Server] Failed to update project spec: ${err}`));
        }
      }
    }
  } else if (parsed.status === "HITL_QUESTION") {
    sessionRef
      .child("metadata")
      .update({ modifiedAt: Date.now(), status: "blocked" });
  } else if (parsed.status === "PROGRESS_UPDATES") {
    sessionRef.child("metadata").update({
      latestUpdate: parsed.completed_status_message || null,
      modifiedAt: Date.now(),
      status: "running"
    }).catch(err => console.error("Failed to update progress log", err));
} else if (parsed.status === "ERROR") {
    sessionRef.child("metadata").transaction((currentData) => {
      if (currentData) {
        if (currentData.status === "complete" || currentData.status === "failed") {
          return; // Abort transaction: no state change needed
        }
        currentData.modifiedAt = Date.now();
        currentData.status = "failed";
      }
      return currentData;
    }).catch(err => console.error("Firebase transaction failed for ERROR:", err));

  } else if (parsed.status !== "WORK_LOG") {
    sessionRef.child("metadata").transaction((currentData) => {
      if (currentData) {
        // Only run the transaction if the status genuinely needs to change
        if (currentData.status === "complete" || currentData.status === "running") {
          return; // Abort transaction: don't fight over modifiedAt timestamps
        }
        currentData.modifiedAt = Date.now();
        currentData.status = "running";
      }
      return currentData;
    }).catch(err => console.warn("Firebase transaction aborted for status update:", err.message));
  }
}

/**
 * Handles incoming messages from clients by parsing and routing them.
 * @param {string} clientUUID - The UUID of the client.
 * @param {IncomingAction} parsedMessage - The message received from the client.
 */
async function handleIncomingMessage(
  clientUUID: string,
  parsedMessage: IncomingAction
): Promise<void> {
  const session = runningSessions.get(clientUUID);
  if (!session) {
    console.error(
      `No active session found for client ${clientUUID} to handle incoming message.`
    );
    return;
  }

  try {
    console.log(
      `Received message status ${parsedMessage.status} from client ${clientUUID}`
    );

    switch (parsedMessage.status) {
      case "ABORT":
        session.abort.abort();
        break;

      case "INITIAL_REQUEST_PARAMS":
        if (parsedMessage.data) {
          handleInitialRequestParams(clientUUID, parsedMessage.data);
        } else {
          console.error(
            `Error: 'data' property is missing for INITIAL_REQUEST_PARAMS from client ${clientUUID}`
          );
        }
        break;

      // NEW: Handle file chunks
      case "FILE_CHUNK":
        if (parsedMessage.data) {
          handleFileChunk(clientUUID, parsedMessage.data);
        } else {
          console.error(
            `Error: 'data' property is missing for FILE_CHUNK from client ${clientUUID}`
          );
        }
        break;

      // NEW: Handle task start signal
      case "START_TASK":
        handleStartTask(clientUUID);
        break;

      case "HITL_RESPONSE":
        if (parsedMessage.answer !== undefined) {
          handleHitlResponse(clientUUID, parsedMessage.answer);
        } else {
          console.error(
            `Error: 'messageId' or 'answer' is missing for HITL_RESPONSE from client ${clientUUID}`
          );
        }
        break;
      default:
        console.log(`Unknown message type: ${parsedMessage.status}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error parsing message from client ${clientUUID}: ${errorMessage}`
    );
  }
}

/**
 * Handles the initial request parameters (without files).
 * Stores the parameters and waits for file chunks.
 */
async function handleInitialRequestParams(
  clientUUID: string,
  requestData: InitialRequestData
): Promise<void> {
  let session = runningSessions.get(clientUUID);
  if (!session) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "A session isn't set up yet for this ID.",
      })
    );
    return;
  }

  if (session.pendingTask || session.runner) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "A task is already running or pending for this client.",
      })
    );
    return;
  }

  try {
    if (!requestData.prompt || !requestData.llmName) {
      sendMessage(
        clientUUID,
        JSON.stringify({
          status: "ERROR",
          message: "Error: prompt or llmName is missing",
        })
      );
      return;
    }

    // Initialize the files array and store the pending task
    requestData.files = [];
    session.pendingTask = requestData;

    // Send acknowledgment to client
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "PARAMS_RECEIVED",
        message: "Parameters received. Ready for files.",
      })
    );
    console.log(
      `Parameters received for client ${clientUUID}. Waiting for files.`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error handling initial params from client ${clientUUID}:`,
      error
    );
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: `Parameter handling failed: ${errorMessage}\n`,
      })
    );
  }
}

/**
 * Handles incoming file chunks and appends them to the pending task.
 */
async function handleFileChunk(
  clientUUID: string,
  chunkData: FileChunkData
): Promise<void> {
  const task = runningSessions.get(clientUUID)?.pendingTask;

  if (!task) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message:
          "Error: No pending task found. Please send INITIAL_REQUEST_PARAMS first.",
      })
    );
    return;
  }

  if (!chunkData.files || !Array.isArray(chunkData.files)) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "Error: Invalid file chunk format.",
      })
    );
    return;
  }

  // Append received files to the task's file list
  task.files = (task.files || []).concat(chunkData.files);
  console.log(
    `Received ${chunkData.files.length} files from client ${clientUUID}. Total files: ${task.files.length}`
  );

  // Send chunk acknowledgment
  sendMessage(clientUUID, JSON.stringify({ status: "CHUNK_RECEIVED" }));
}

/**
 * Handles the signal to start the task after all files are uploaded.
 */
async function handleStartTask(clientUUID: string): Promise<void> {
  const session = runningSessions.get(clientUUID);
  const taskData = session?.pendingTask;

  if (!taskData) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "Error: No task data found to start.",
      })
    );
    return;
  }

  // Task data is complete. Remove it from pending and start the orchestrator.
  session.pendingTask = undefined;
  console.log(
    `All files received for client ${clientUUID}. Starting orchestrator...`
  );

  // Call the original handleInitialRequest function with the now-complete data
  await handleInitialRequest(clientUUID, taskData);
}

async function handleInitialRequest(
  clientUUID: string,
  requestData: InitialRequestData
): Promise<void> {
  let session = runningSessions.get(clientUUID);
  if (!session) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "A session isn't set up yet for this ID.",
      })
    );
    return;
  }

  if (session.runner) {
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: "A task is already running for this client.",
      })
    );
    return;
  }

  let runnerName = 'Orchestrator';

  try {
    if (!requestData.prompt || !requestData.llmName) {
      sendMessage(
        clientUUID,
        JSON.stringify({
          status: "ERROR",
          message: "Error: prompt or llmName is missing",
        })
      );
      return;
    }

    const {
      prompt,
      llmName,
      maxTurns,
      githubUrl,
      assumptions,
      files, 
      saveFiles,
      secrets,
      mode,
      projectId,
      projectSpecification: requestProjectSpecification,
      environmentInstructions, 
      notWorkingBuild,
      image,
      imageMimeType,
      weaveId,
    } = requestData as InitialRequestData & { projectId?: string; mode?: string; projectSpecification?: string };

    const projectSpecification = await resolveProjectSpecification(requestProjectSpecification, weaveId);
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "WORK_LOG",
        message: `Working from Project Specification:\n\n${projectSpecification}`,
      })
    );

    session.projectId = projectId;
    session.mode = mode;

    const isAnalyzer = mode === ServerMode.ANALYZER;
    runnerName = isAnalyzer ? 'Analyzer' : 'Orchestrator';

    // Inside your task initialization logic:
    const assumptionsPath = path.join(__dirname, '../src/assets/assumptions/research_agent.txt');
    const baseAssumptions = fs.readFileSync(assumptionsPath, 'utf-8');
    const combinedAssumptions = `${baseAssumptions}\n${requestData.assumptions || ''}`;

    // 1. Create a new, request-specific Config instance
    const requestConfig = new Config({
      sessionId: randomUUID(),
      debugMode: false,
      model: llmName, 
      maxTurns: maxTurns ?? 20,
      assumptions: combinedAssumptions,
      embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
      cwd: process.cwd(),
      // --- Fill in other default values ---
      question: "",
      fullContext: false,
      fileFiltering: {
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      },
    });

    await requestConfig.refreshAuth(AuthType.USE_GEMINI, {
      geminiApiKey: secrets.geminiApiKey,
      googleApiKey: secrets.geminiApiKey,
    });

    const geminiClient = await requestConfig.getGeminiClient();

    // 1. Create a simulated WebSocket to trick the ProgressQueue into writing to Firebase
    const firebaseWsAdapter = {
      readyState: 1, // Simulates WebSocket.OPEN
      send: (msg: string) => sendMessage(clientUUID, msg)
    } as any;

    // 2. Instantiate the queue for this specific session
    const progressQueue = new ProgressQueue(firebaseWsAdapter, clientUUID);

    // 3. Create the interceptor callback
    const sendMessageCallback = (message: any) => {
      // Route tagged updates (Strings and Promises) to the queue
      if (typeof message === 'object' && message !== null && message.type === 'PROGRESS_UPDATE') {
        progressQueue.add(message.message);
      } 
      // Fallback for everything else (WORK_LOG, COMPLETE_RESULT, etc.)
      else if (typeof message === 'string') {
        sendMessage(clientUUID, message);
      }
    };

    // Decode file content and use the library to differentiate binary/text
    const fileMap = new Map<string, string>();
    const binaryFileMap = new Map<string, string>();

if (githubUrl) {
      // Parse repo, branch, and subdirectory path
      // Syntax: Owner/Repo#BranchName/repopath
      let repoUrl = githubUrl;
      let branch: string | undefined;
      let repoPath: string | undefined;

      // 1. Split Branch/Path from Repo URL
      if (githubUrl.includes('#')) {
        const [urlPart, branchPart] = githubUrl.split('#');
        repoUrl = urlPart;
        
        // 2. Split Path from Branch
        // If branchPart contains a '/', everything after is the path
        const pathIndex = branchPart.indexOf('/');
        if (pathIndex !== -1) {
          branch = branchPart.substring(0, pathIndex);
          repoPath = branchPart.substring(pathIndex + 1);
          // Clean trailing slash from path for consistent matching
          if (repoPath.endsWith('/')) repoPath = repoPath.slice(0, -1);
        } else {
          branch = branchPart;
        }
      }

      // clone repo and read it into memory
      // TODO: blow up if the repo is too big
      sendMessage(
        clientUUID,
        JSON.stringify({
          status: "WORK_LOG",
          message: `# Cloning git repo:\n${repoUrl} (Branch: ${branch || "default"})${repoPath ? `\nFiltering for path: /${repoPath}` : ""}\n\n`,
        })
      );
      try {
        // Note: We pass the combined "Owner/Repo#Branch" to gitUtils if your 
        // gitUtils supports parsing it, OR pass clean args if you updated gitUtils previously.
        // Assuming gitUtils handles the basic #branch syntax or we reconstruct it:
        const cloneInputUrl = branch ? `${repoUrl}#${branch}` : repoUrl;

        let cloneResults = await cloneRepoIntoMemory({
          repoUrl: cloneInputUrl, 
          githubToken: secrets.githubToken,
          fileMap,
          binaryFileMap,
        });

        // --- NEW: Filter files based on repoPath ---
        if (repoPath) {
          const pathPrefix = repoPath + '/'; // Ensure we match directories correctly
          
          // Filter text files
          for (const [key] of fileMap) {
            // Check if file equals the path (if it's a file) or starts with directory prefix
            if (key !== repoPath && !key.startsWith(pathPrefix)) {
              fileMap.delete(key);
            }
          }
          
          // Filter binary files
          for (const [key] of binaryFileMap) {
            if (key !== repoPath && !key.startsWith(pathPrefix)) {
              binaryFileMap.delete(key);
            }
          }
          
          // Filter the log results for the user
          cloneResults = cloneResults.filter((r) => r.path === repoPath || r.path.startsWith(pathPrefix));
        }
        // -------------------------------------------

        sendMessage(
          clientUUID,
          JSON.stringify({
            status: "WORK_LOG",
            message:
              "Success!\n\n" +
              cloneResults
                .map((r) => `- ${r.path} ${r.comment ? `(${r.comment})` : ""}`)
                .join("\n") +
              "\n\n",
          })
        );
      } catch (e) {
        sendMessage(
          clientUUID,
          JSON.stringify({
            status: "WORK_LOG",
            message: `Error cloning git repo:\n${e}\n\n`,
          })
        );
      }
    }

    if (files) {
      files.forEach((file) => {
        const fileBuffer = Buffer.from(file.content, "base64");

        // Use the library to check if the buffer is a binary file
        if (isBinaryFileSync(fileBuffer)) {
          // If binary, store the original base64 content
          binaryFileMap.set(file.name, file.content);
        } else {
          // If text, decode to a UTF-8 string
          fileMap.set(file.name, fileBuffer.toString("utf-8"));
        }
      });
    }

    // 2.5b Update session title
    let sessionTitle = "Untitled Session"
    await generateSessionTitle(requestData.prompt, geminiClient).then((title) => {
      let sessionRef = db.ref(SESSION_ROOT_PATH).child(clientUUID);
      sessionRef.child("metadata").update({ title });
      sessionTitle = title;
    });


    // 2. Create and store the Runner instance (Orchestrator or Analyzer)
    const runner = new Orchestrator(
          prompt,
          image,
          imageMimeType,
          fileMap,
          binaryFileMap,
          geminiClient,
          sendMessageCallback,
          assumptions ?? "",
          llmName,
          saveFiles ?? true,
          secrets,
          requestConfig,
          sessionTitle,
          projectSpecification,
          environmentInstructions,
          notWorkingBuild,
          session.abort.signal,
          mode as ServerMode | undefined,
          SERVER_MAX_DURATION_MS,
          SERVER_GRACE_PERIOD_MS,
        );

    session.runner = runner;

    console.log(
      `LOGGING: Invoking ${runnerName} for client ${clientUUID} using model ${llmName}`
    );
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "WORK_LOG",
        message: `# ${runnerName} invoked successfully:\n${prompt}\n\n`,
      })
    );

    // 3. Run the runner asynchronously
    runner
      .run()
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`${runnerName} for client ${clientUUID} failed:`, error);
        sendMessage(
          clientUUID,
          JSON.stringify({
            status: "ERROR",
            message: `${runnerName} failed: ${errorMessage}\n`,
          })
        );
      })
      .finally(() => {
        console.log(
          `${runnerName} task finished for client ${clientUUID}. Cleaning up.`
        );
        session.bus.dispatchEvent(new Event("sessionComplete"));
        const sessionRef = db.ref(SESSION_ROOT_PATH).child(clientUUID);
        // TODO: set status based on success/failure
        sessionRef.child("metadata").update({ status: "complete" });
      });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error handling initial request from client ${clientUUID}:`,
      error
    );
    sendMessage(
      clientUUID,
      JSON.stringify({
        status: "ERROR",
        message: `${runnerName} invocation failed: ${errorMessage}\n`,
      })
    );
  }
}

/**
 * MODIFIED: Handles a Human-In-The-Loop (HITL) response from the client.
 * @param {string} clientUUID - The UUID of the client.
 * @param {any} answer - The response data from the user.
 */
async function handleHitlResponse(
  clientUUID: string,
  answer: any
): Promise<void> {
  const runner = runningSessions.get(clientUUID)?.runner;

  if (runner && runner instanceof Orchestrator) {
    // Only Orchestrator supports HITL resolution
    runner.resolveHitl(answer);
  } else {
    console.error(
      `No active Orchestrator found for client ${clientUUID} to handle HITL response.`
    );
  }
}

/**
 * Aborts a running session by triggering the AbortController signal.
 * @param sessionId The ID of the session to abort.
 * @returns true if the session was found and aborted, false otherwise.
 */
function abortSession(sessionId: string): boolean {
  const session = runningSessions.get(sessionId);
  if (session) {
    console.log(`Manually aborting session ${sessionId}`);
    session.abort.abort();
    return true;
  }
  console.warn(`Attempted to abort non-existent session ${sessionId}`);
  return false;
}
 
/**
 * Deletes a project and all its associated data (metadata, sessions, chat)
 * in a secure, cascading manner, ensuring only the owner can perform the action.
 * @param projectId The ID of the project to delete.
 * @param requesterUid The UID of the user requesting the deletion.
 * @returns A promise that resolves to true if deletion was successful.
 * @throws An error if authorization fails or the project does not exist.
 */
async function deleteProjectAndDependencies(
  projectId: string,
  requesterUid: string
): Promise<boolean> {
  const projectRef = db.ref(`${PROJECT_ROOT_PATH}/${projectId}`);
  const metadataRef = projectRef.child("metadata");

  // 1. Read metadata to verify ownership
  const metadataSnapshot = await metadataRef.get();
  if (!metadataSnapshot.exists()) {
    throw new Error(`Project with ID ${projectId} not found.`);
  }

  const metadata = metadataSnapshot.val() as ProjectMetadata;

  // 2. Verify ownership
  if (metadata.ownerId !== requesterUid) {
    throw new Error("Authorization failed: Requester is not the project owner.");
  }

  // 3. Query and prepare deletions for associated sessions.
  const sessionsRef = db.ref(SESSION_ROOT_PATH);
  const sessionsQuery = sessionsRef
    .orderByChild("metadata/projectId")
    .equalTo(projectId);

  const sessionsSnapshot = await sessionsQuery.get();

  const updates: { [key: string]: null } = {};

  // Add project deletion path
  updates[`${PROJECT_ROOT_PATH}/${projectId}`] = null;

  // Add session deletion paths
  let deletedSessionCount = 0;
  sessionsSnapshot.forEach((childSnapshot) => {
    const sessionId = childSnapshot.key;
    if (sessionId) {
      updates[`${SESSION_ROOT_PATH}/${sessionId}`] = null;
      deletedSessionCount++;
    }
  });

  // 4. Perform atomic multi-path delete
  await db.ref().update(updates);

  console.log(
    `Project ${projectId} and all dependencies deleted successfully. (Deleted ${deletedSessionCount} sessions)`
  );
  return true;
}

// Export the public functions
export {
  db,
  abortSession,
  deleteProjectAndDependencies,
  handleFileChunk,
  handleHitlResponse,
  handleIncomingMessage,
  handleInitialRequest,
  handleInitialRequestParams,
  handleStartTask,
  sendMessage,
};
