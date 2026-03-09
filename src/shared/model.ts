export const SESSION_ROOT_PATH = "julesmomoa/sessions";
export const USERINFO_ROOT_PATH = "julesmomoa/userinfo";
export const PROJECT_ROOT_PATH = "julesmomoa/projects";

// --- Type Definitions ---

// MODIFIED: Update WebSocketMessage status types
/**
 * Defines the structure for incoming messages.
 */
export type IncomingAction = {
  status:
    | "INITIAL_REQUEST_PARAMS"
    | "FILE_CHUNK"
    | "START_TASK"
    | "HITL_RESPONSE"
    | "ABORT"
    | (string & {});
  data?: any; // Use 'any' for data to accommodate different payload structures
  messageId?: string;
  answer?: any;
};

export enum ServerMode {
   ORCHESTRATOR = 'orchestrator',
   ANALYZER = 'analyzer',
   ENRICH_AND_DECONSTRUCT = "ENRICH_AND_DECONSTRUCT",
   IDENTIFY_NEXT_TASK = "IDENTIFY_NEXT_TASK"
};

/**
 * Defines the structure for the data in an 'INITIAL_REQUEST_PARAMS' message,
 * matching the Python client's payload but without files.
 */
export interface InitialRequestData {
  prompt: string;
  image?: string; // Optional Base64 encoded image data
  imageMimeType?: string; // Optional MIME type of the attached image
  llmName: string;
  githubUrl?: string;
  maxTurns?: number;
  assumptions?: string; // Client sends a single string
  files?: { name: string; content: string }[]; // This will be populated by chunks
  saveFiles?: boolean;
  secrets: UserSecrets;
  mode?: ServerMode; //'orchestrator' | 'analyzer';
  projectId?: string;
  projectSpecification?: string;
  environmentInstructions?: string;
  notWorkingBuild?: boolean;
  weaveId?: string;
  maxDurationMs?: number;
  gracePeriodMs?: number;
}

export interface UserSecrets {
  geminiApiKey: string;
  julesApiKey: string;
  githubToken: string;
  stitchApiKey: string;
  e2BApiKey: string;
  githubScratchPadRepo: string;
}

/**
 * NEW: Defines the structure for the data in a 'FILE_CHUNK' message.
 */
export interface FileChunkData {
  files: { name: string; content: string }[];
}

export interface ProjectMetadata {
  title: string;
  description: string;
  ownerId: string;
  repoPath?: string;
  githubUrl?: string;
}

// TODO!
export interface OutgoingMessage {
  // all
  status:
    | "USER_MESSAGE"
    | "WORK_LOG"
    | "ERROR"
    | "PROGRESS_UPDATES"
    | 'HITL_QUESTION'
    | "COMPLETE_RESULT"
    | (string & {});
  // USER_MESSAGE, WORK_LOG, ERROR
  message?: string;
  // PROGRESS_UPDATES
  completed_status_message?: string;
  current_status_message?: string;
  // COMPLETE_RESULT
  data?: {
    feedback?: string;
    files?: string;
    result?: string;
    retrospective?: string;
  };
}

export interface HistoryItem extends OutgoingMessage {
  timestamp: number;
  runnerInstanceId: string;
}