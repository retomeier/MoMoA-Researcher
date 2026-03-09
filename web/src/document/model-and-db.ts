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

import { generateId } from "./util";

export type SessionMetadata = {
  title: string;
  status: "pending" | "running" | "complete" | "failed" | "blocked";
  startedAt?: number;
  modifiedAt?: number;
  latestUpdate?: string;
  runnerInstanceId?: string;
  projectId?: string;
};

export const SESSION_METADATA_TEMPLATE: SessionMetadata = {
  title: "New session",
  status: 'pending',
};

export type ProjectMetadata = {
  projectId: string;
  title: string;
  description: string;
  ownerId: string;
  spec?: string;
  proposed_spec?: string;
  repoPath?: string;
  githubUrl?: string;
  weaveId?: string;
  activeAnalysisSessionId?: string;
  initialPrompt?: string;
};

export type ProposedTask = {
  id: string;
  title: string;
  createdAt?: number;
};

export const PROJECT_METADATA_TEMPLATE: ProjectMetadata = {
  title: "New Project",
  description: "",
  ownerId: "",
  projectId: generateId()
};