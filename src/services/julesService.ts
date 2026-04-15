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

import fetch from 'node-fetch';
import { VerbosityType } from '../momoa_core/types.js';
import { GeminiClient } from './geminiClient.js';
import { DEFAULT_GEMINI_LITE_MODEL } from '../config/models.js';
import { removeBacktickFences } from '../utils/markdownUtils.js';
import { getAssetString, replaceRuntimePlaceholders } from './promptManager.js';

export enum JulesSessionState {
  STATE_UNSPECIFIED = 'STATE_UNSPECIFIED',
  QUEUED = 'QUEUED',
  PLANNING = 'PLANNING',
  AWAITING_PLAN_APPROVAL = 'AWAITING_PLAN_APPROVAL',
  AWAITING_USER_FEEDBACK = 'AWAITING_USER_FEEDBACK',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

export interface SourceContext {
  source: string;
  githubRepoContext: GitHubRepoContext;
}

export interface JulesSession {
  name: string;
  id: string;
  prompt: string;
  title?: string;
  createTime: string;
  updateTime: string; 
  state: JulesSessionState;
  url: string
  sourceContext: SourceContext;
  outputs: SessionOutput[]
}

export interface SessionOutput {
  pullRequest: PullRequest;
}

export interface PullRequest {
  url: string;
  title: string;
  description: string;
}

export interface ListSessionsResponse {
  sessions: JulesSession[];
}

export interface GitHubRepoContext {
  startingBranch: string;
}

export interface GitHubBranch {
  displayName: string;
}

export interface GitHubRepo {
  owner: string;
  repo: string;
  isPrivate: boolean;
  defaultBranch: GitHubBranch;
  branches: GitHubBranch[];
}

export interface JulesSource {
  name: string;
  githubRepo: GitHubRepo;
}

export interface ListSourcesResponse {
  sources: JulesSource[];
  nextPageToken: string;
}

export interface AgentMessaged {
  agentMessage: string;
}

export interface UserMessaged {
  userMessage: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  index: number;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  createTime: string;
}

export interface PlanGenerated {
  plan: Plan;
}

export interface PlanApproved {
  planId: string;
}

// -- Progress & Status Interfaces --

export interface ProgressUpdated {
  title: string;
  description: string;
}

export interface SessionCompleted {
}

export interface SessionFailed {
  reason: string;
}

export interface GitPatch {
  unidiffPatch: string;
  baseCommitId: string;
  suggestedCommitMessage: string;
}

export interface ChangeSet {
  source: string;
  gitPatch: GitPatch;
}

export interface BashOutput {
  command: string;
  output: string;
  exitCode: number;
}

export interface Media {
  data: string;
  mimeType: string;
}

export interface Artifact {
  changeSet?: ChangeSet; 
  bashOutput?: BashOutput; 
  media?: Media;
}

export interface Activity {
  name: string;
  id: string;
  description: string;
  createTime: string;
  originator: string;
  artifacts?: Artifact[];
  agentMessaged?: AgentMessaged;
  userMessaged?: UserMessaged;
  planGenerated?: PlanGenerated;
  planApproved?: PlanApproved;
  progressUpdated?: ProgressUpdated;
  sessionCompleted?: SessionCompleted;
  sessionFailed?: SessionFailed;
}

export interface ListActivitiesResponse {
  activities: Activity[];
}

export const JULES_API_BASE_URL = 'https://jules.googleapis.com';

export class JulesAPIService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getSessions(): Promise<JulesSession[] | { error: string }> {
    if (!this.apiKey) {
      console.error('API Key not loaded');
      return { error: 'API Key not loaded' };
    }
    try {
      // Calls the list method for sessions
      const response = await fetch(`${JULES_API_BASE_URL}/v1alpha/sessions`, {
        headers: { 'x-goog-api-key': this.apiKey }
      });
      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }
      const data = await response.json() as ListSessionsResponse;
      return data.sessions  || [];
    } catch (error: any) {
      console.error('Error fetching Jules tasks:', error);
      return { error: error.message };
    }
  }

  /**
   * Fetches a complete list of Jules projects (sources), handling pagination automatically.
   * Can optionally filter the results by name.
   * @param sourceNames - Optional. An array of full source names to filter by (e.g., ['sources/project-one']).
   * @returns A promise that resolves to a complete array of JulesSource objects or an error object.
   */
  async getProjects(sourceNames?: string[]): Promise<JulesSource[] | { error: string }> {
    if (!this.apiKey) {
      console.error('API Key not loaded');
      return { error: 'API Key not loaded' };
    }

    // This array will accumulate sources from all pages.
    const allSources: JulesSource[] = [];
    let pageToken: string | undefined = undefined;

    try {
      do {
        const url = new URL(`${JULES_API_BASE_URL}/v1alpha/sources`);

        // Apply the filter, if provided.
        if (sourceNames && sourceNames.length > 0) {
          const filterString = sourceNames
            .map(name => `name=${name}`)
            .join(' OR ');
          url.searchParams.append('filter', filterString);
        }

        // Set page size to the maximum allowed value to reduce API calls.
        url.searchParams.append('pageSize', '100');

        // If we have a pageToken from a previous request, add it to the URL.
        if (pageToken) {
          url.searchParams.append('pageToken', pageToken);
        }

        const response = await fetch(url.toString(), {
          headers: { 'x-goog-api-key': this.apiKey }
        });

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`API Error: ${response.status} ${response.statusText}`, errorBody);
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as ListSourcesResponse;

        // Add the sources from the current page to our master list.
        if (data.sources && data.sources.length > 0) {
          allSources.push(...data.sources);
        }

        // Get the token for the next page. If it's undefined, the loop will end.
        pageToken = data.nextPageToken;

      } while (pageToken); // Continue looping as long as there is a next page.

      //console.log(`Successfully fetched a total of ${allSources.length} sources.`);
      return allSources;

    } catch (error: any) {
      console.error('Error fetching Jules projects:', error);
      return { error: error.message };
    }
  }

  async createSession(prompt: string, sourceName: string, branchName: string): Promise<JulesSession | { error: string }> {
    if (!this.apiKey) {
      console.error('API Key not loaded');
      return { error: 'API Key not loaded' };
    }

    const sessionBody = {
      prompt,
      requirePlanApproval: false,
      sourceContext: {
        source: sourceName,
        githubRepoContext: {
          startingBranch: branchName
        }
      }
    };

    try {
      // Calls the create method for sessions
      const response = await fetch(`${JULES_API_BASE_URL}/v1alpha/sessions`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sessionBody)
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errText}`);
      }
      const data = await response.json() as JulesSession;
      return data; // Return the newly created session
    } catch (error: any) {
      console.error('Error creating Jules task:', error);
      return { error: error.message };
    }
  }

  async getSession(sessionName: string): Promise<JulesSession | { error: string }> {
    if (!this.apiKey) {
      return { error: 'API Key not loaded' };
    }
    try {
      const response = await fetch(`${JULES_API_BASE_URL}/v1alpha/${sessionName}`, {
        headers: { 'x-goog-api-key': this.apiKey },
      });
      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }
      return await response.json() as JulesSession;
    } catch (error: any) {
      //console.error(`Error fetching session ${sessionName}:`, error);
      return { error: error.message };
    }
  }

  async listActivities(sessionName: string): Promise<Activity[] | { error: string }> {
    if (!this.apiKey) {
      return { error: 'API Key not loaded' };
    }
    try {
        sessionName = sessionName.replace("sessions/", "");
        const fetchString = `${JULES_API_BASE_URL}/v1alpha/sessions/${sessionName}/activities`;
        //console.log("Fetching: " +  fetchString);
        const response = await fetch(fetchString, {
            headers: { 'x-goog-api-key': this.apiKey },
        });
        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }
        const data = await response.json() as ListActivitiesResponse;
        return data.activities || [];
        } catch (error: any) {
          //console.error(`Error listing activities for session ${sessionName}:`, error);
          return [];
        }
    }

  async postUserMessage(sessionName: string, message: string): Promise<{ success: boolean } | { error: string }> {
      if (!this.apiKey) {
          return { error: 'API Key not loaded' };
      }
      
      // The API expects a simple "prompt" in the body.
      const messageBody = {
          prompt: message
      };

      try {
          // The URL must use the full sessionName and the ":sendMessage" custom method.
          // DO NOT strip "sessions/" from the sessionName.
          const url = `${JULES_API_BASE_URL}/v1alpha/${sessionName}:sendMessage`;
          
          const response = await fetch(url, {
              method: 'POST',
              headers: {
                  'x-goog-api-key': this.apiKey,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify(messageBody)
          });

          if (!response.ok) {
              const errText = await response.text();
              throw new Error(`API Error: ${response.statusText} - ${errText}`);
          }
          
          // According to the documentation, the response body is empty on success.
          // We will return a simple success object instead of an Activity.
          return { success: true }; 
      } catch (error: any) {
          console.error(`Error posting user message to session ${sessionName}:`, error);
          return { error: error.message };
      }
  }
}

/**
 * Compares the data for each Jules session from the 'list' API endpoint
 * against the 'get' API endpoint and logs only the differences found.
 */
export async function compareJulesSessions(julesService: JulesAPIService) {
    if (!julesService) {
        const errorMessage = 'Jules API Service not initialized. API Key may be missing.';
        console.error(errorMessage);
        //dialog.showErrorBox('API Key Not Set', 'Please set your API key before comparing Jules sessions.');
        return;
    }

    console.log('🚀 Starting Jules session comparison...');
    const sessionsListResult = await julesService.getSessions();

    if ('error' in sessionsListResult) {
        console.error('Failed to fetch session list:', sessionsListResult.error);
        return;
    }
    
    if (sessionsListResult.length === 0) {
        console.log('No Jules sessions found to compare.');
        return;
    }

    let differencesFound = false;
    for (const sessionFromList of sessionsListResult) {
        const detailedSessionResult = await julesService.getSession(sessionFromList.name);

        if ('error' in detailedSessionResult) {
            console.error(`Failed to fetch details for session ${sessionFromList.name}:`, detailedSessionResult.error);
            continue; 
        }
        console.log(`Session State List ${sessionFromList.state}`);
        console.log(`Session State Get ${detailedSessionResult.state}`);
        const differences = findDifferences(sessionFromList, detailedSessionResult);

        if (differences.length > 0) {
            differencesFound = true;
            console.log(`\n❌ Differences found for session: ${sessionFromList.name}`);
            differences.forEach(diff => console.log(`  ${diff}`));
        }
    }

    if (!differencesFound) {
        console.log('✅ All session data is IDENTICAL between list and get APIs.');
    }
    console.log('\n--- Jules session comparison finished. ---');
}

/**
 * Performs a deep comparison between two objects and returns an array of strings
 * describing the differences.
 * @param obj1 The first object (from the LIST call).
 * @param obj2 The second object (from the GET call).
 * @param path The current path for nested objects (used for recursion).
 * @returns An array of strings detailing the differences.
 */
function findDifferences(obj1: any, obj2: any, path: string = ''): string[] {
    const differences: string[] = [];
    if (obj1 === null || obj2 === null) {
        if (obj1 !== obj2) {
            differences.push(`- Path '${path}': '${JSON.stringify(obj1)}' (LIST) vs '${JSON.stringify(obj2)}' (GET)`);
        }
        return differences;
    }
    
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

    for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;
        const val1 = obj1[key];
        const val2 = obj2[key];

        if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null && !Array.isArray(val1) && !Array.isArray(val2)) {
            differences.push(...findDifferences(val1, val2, newPath));
        } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
            let diffString = `- Key '${newPath}': `;
            if (val1 === undefined) {
                diffString += `not in LIST vs '${JSON.stringify(val2)}' (GET)`;
            } else if (val2 === undefined) {
                diffString += `'${JSON.stringify(val1)}' (LIST) vs not in GET`;
            } else {
                diffString += `'${JSON.stringify(val1)}' (LIST) vs '${JSON.stringify(val2)}' (GET)`;
            }
            differences.push(diffString);
        }
    }
    return differences;
}

/**
 * Formats a Plan object into a readable string listing all steps.
 */
export function formatPlan(plan: Plan): string {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return '  No steps in plan.';
  }

  const header = `  Plan ID: ${plan.id} (Created: ${plan.createTime})`;
  const steps = plan.steps
    .sort((a, b) => a.index - b.index) // Ensure steps are in order
    .map(step => {
      return `    [Step ${step.index + 1}] ${step.title}\n      Details: ${step.description}`;
    })
    .join('\n');

  return `${header}\n${steps}`;
}

/**
 * Formats a BashOutput artifact into a readable block.
 */
export function formatBashOutput(bash: BashOutput): string {
  if (!bash) return '  No bash output data.';

  let result = `$> ${bash.command}`;

  if (bash.exitCode)
    result += `\n[Exit Code: ${bash.exitCode}]`;

  result += `Output:
  ${bash.output.trim().replace(/^/gm, '    ')} 
  `; // Indents the output for readability

  return result;
}

/**
 * Helper to log an Activity's specific content based on its type.
 */
export async function formatActivityContent(activity: Activity, verbosity: VerbosityType = VerbosityType.AISummarize, geminiClient?: GeminiClient, assignedTask?: string): Promise<string> {
  const parts: string[] = [];
  
  if ((verbosity == VerbosityType.AISummarize) && (!geminiClient)) {
    console.warn("AISummarize verbosity selected without a Gemini Client. Defaulting to Quiet.");
    verbosity = VerbosityType.Quiet
  }

  if (verbosity == VerbosityType.Verbose)
    parts.push(`Activity: ${activity.name} (${activity.createTime})`);

  if (activity.agentMessaged) {
    parts.push(`Message from Agent:\n${activity.agentMessaged.agentMessage}`);
  }
  if (activity.userMessaged) {
    parts.push(`Message from User: "${activity.userMessaged.userMessage}"`);
  }
  if (activity.planGenerated) {
    parts.push(`Jules Plan Generated`);
    if (verbosity == VerbosityType.Verbose) {
      parts.push(`:\n${formatPlan(activity.planGenerated.plan)}`);
    }
  }
  if (activity.planApproved) {
    parts.push(`Jules Plan Approved`);
      if (verbosity == VerbosityType.Verbose) {
      parts.push(`: ${activity.planApproved.planId}`);
    }
  }
  if (activity.progressUpdated) {
    if (activity.progressUpdated.title || activity.progressUpdated.description) {
      const { title, description } = activity.progressUpdated;

      // 1. Remove trailing ellipses/whitespace from title for comparison
      const cleanTitle = title ? title.replace(/(\.{3}|…)$/, "").trim() : "";

      // 2. Check if the description contains the cleaned title
      const isTitleInDescription = description && cleanTitle && description.includes(cleanTitle);

      // 3. Only add title if it is NOT found in the description
      if (title && !isTitleInDescription) {
        parts.push(`${title}`);
      }

      // 4. Always add description if it exists
      if (description) { 
        parts.push(`${description}`);
      }
    }
  }
  if (activity.sessionFailed) {
    parts.push(`Session Failed: ${activity.sessionFailed.reason}`);
  }

  // Handle Artifacts (BashOutput, etc.)
  if (activity.artifacts && activity.artifacts.length > 0) {
    // parts.push(`  Artifacts:`);
    for (const artifact of activity.artifacts) {
      if (artifact.bashOutput && (verbosity !== VerbosityType.Quiet)) {
        parts.push(`[Bash Command Run]`);
        if (verbosity == VerbosityType.Verbose) {
          parts.push(`${formatBashOutput(artifact.bashOutput)}`);
        } else if (verbosity == VerbosityType.AISummarize && geminiClient) {
          const formattedBashOutput = formatBashOutput(artifact.bashOutput);
          
          const prompt = await replaceRuntimePlaceholders(await getAssetString("bash-summarizer"), {
            BashOutput: formattedBashOutput,
            AssignedTask: assignedTask || '---No Task Specified---',
          })
          
          const summarizedBash = (await geminiClient.sendOneShotMessage(
            prompt,
            { model: DEFAULT_GEMINI_LITE_MODEL }
          ))?.text || formattedBashOutput;

          const cleansummarizedBash = removeBacktickFences(summarizedBash);
          parts.push(cleansummarizedBash);
        }
      }
    }
  }

  return parts.join('\n');
}