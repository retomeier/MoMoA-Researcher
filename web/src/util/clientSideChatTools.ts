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

import { get, ref, update } from "firebase/database";
import { MODIFY_SPEC_TOOL_NAME, ModifySpecResult, READ_FILES_TOOL_NAME, ToolResult, USER_ROLE } from "../../../src/momoa_core/types";
import { PROJECT_ROOT_PATH } from "../../../src/shared/model";
import { db } from "@/firebase";
import { normalizeRepoUrl } from "./git-urls";

export function removeBacktickFences(text: string): string {
  const trimmedText = text.trim();
  const lines = trimmedText.split('\n');

  // Check if there are at least two lines (for opening and closing fences)
  // and if the first line starts with '```' and the last line (when trimmed) is
  //  exactly '```'.
  if (
    lines.length >= 2 &&
    lines[0].trim().startsWith('```') &&
    lines[lines.length - 1].trim() === '```'
  ) {
    // Extract the content between the fences
    const contentLines = lines.slice(1, lines.length - 1);
    const content = contentLines.join('\n');
    return content;
  } else if (
    lines.length === 1 &&
    lines[0].trim().startsWith('`') &&
    lines[0].trim().endsWith('`')) {
    const content = lines[0].slice(1, -1);
    return content;
  }

  // If conditions are not met, return the original untrimmed string
  return text;
}

export const cleanLLMOutput = (text: string): string => {
  if (!text) return "";

  return text
    // 1. Replace 3+ newlines with just 2 (prevents massive empty gaps)
    .replace(/\n{3,}/g, '\n\n')
    
    // 2. (Optional) Tighten lists: removes blank lines between bullets/numbers
    //    Matches a newline, then a newline, then a bullet/number.
    .replace(/\n\n(?=[-*+]|\d+\.)/g, '\n')
    
    // 3. Trim outer whitespace so the chat bubble doesn't have padding quirks
    .trim();
};

/**
 * Fetches the content of a single file from GitHub.
 * @param org The GitHub organization/owner.
 * @param repo The GitHub repository name.
 * @param fileName The path and name of the file to read.
 * @param githubToken The GitHub personal access token for authentication.
 * @returns A promise resolving to the decoded file content string, or an error message string.
 */
async function fetchSingleFileContent(
  org: string,
  repo: string,
  fileName: string,
  githubToken: string
): Promise<string> {
  if (!fileName) {
    return `Error: File name is missing.`;
  }

  try {
    const apiUrl = `https://api.github.com/repos/${org}/${repo}/contents/${fileName}`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${githubToken}`,
      },
    });

    if (response.status === 404) {
      return `File not found in repository: ${fileName}`;
    }

    if (!response.ok) {
      const errorText = await response.text();
      return `Error fetching file content (Status ${response.status}). Details: ${errorText.substring(0, 100)}`;
    }

    const data = await response.json();

    if (data.type !== 'file' || !data.content) {
        return `Error: GitHub API returned unexpected data structure for ${fileName}. It might be a directory or symlink.`;
    }

    // Decode Base64 content (assuming atob is available client-side)
    const decodedContent = atob(data.content.replace(/\s/g, ''));

    return decodedContent;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `A network or unexpected error occurred while reading file: ${errorMessage}`;
  }
}

// Tool stubs for client-side ReAct loop
export const execute_read_file_tool = async (
  projectId: string | undefined,
  fileNames: string[],
  githubToken: string | undefined
): Promise<ToolResult> => {
  // 4. Validation
  if (!projectId) {
    return {
      role: USER_ROLE,
      name: READ_FILES_TOOL_NAME,
      response: `Error: Project ID is missing.`,
      filename: 'multiple files'
    };
  }
  if (!fileNames || fileNames.length === 0) {
    return {
      role: USER_ROLE,
      name: READ_FILES_TOOL_NAME,
      response: `Error: File names array is empty or missing.`,
      filename: 'multiple files'
    };
  }
  if (!githubToken) {
    return {
      role: USER_ROLE,
      name: READ_FILES_TOOL_NAME,
      response: `Error: GitHub token is missing. Cannot authenticate API request.`,
      filename: 'multiple files'
    };
  }

  try {
    // 5. Fetch githubUrl
    const { githubUrl } = await getProjectMetadata(projectId);

    if (!githubUrl) {
      return {
        role: USER_ROLE,
        name: READ_FILES_TOOL_NAME,
        response: `Error: Project ${projectId} does not have an associated GitHub URL.`,
        filename: 'multiple files'
      };
    }

    // 6. Normalize URL
    const { org, repo } = normalizeRepoUrl(githubUrl);

    if (!org || !repo) {
      return {
        role: USER_ROLE,
        name: READ_FILES_TOOL_NAME,
        response: `Error: Could not parse organization or repository name from URL: ${githubUrl}`,
        filename: 'multiple files'
      };
    }

    // 7. Process all files concurrently
    const results: Record<string, string> = {};
    const promises = fileNames.map(fileName => 
      fetchSingleFileContent(org, repo, fileName, githubToken)
    );
    
    const fileContents = await Promise.all(promises);

    fileNames.forEach((fileName, index) => {
      results[fileName] = fileContents[index];
    });

    // 8. Return structured JSON response
    return {
      role: USER_ROLE,
      name: READ_FILES_TOOL_NAME,
      response: JSON.stringify(results, null, 2),
      filename: 'multiple files'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      role: USER_ROLE,
      name: READ_FILES_TOOL_NAME,
      response: `A network or unexpected error occurred during batch processing: ${errorMessage}`,
      filename: 'multiple files'
    };
  }
};

export const execute_modify_spec_tool = async (projectId: string  | undefined, modifySpecResult: ModifySpecResult): Promise<ToolResult> => {
    const result = await generateProposedUpdate(projectId, modifySpecResult);
    return {
        role: USER_ROLE,
        name: MODIFY_SPEC_TOOL_NAME,
        response: result.result,
    };
};

async function generateProposedUpdate(projectId: string | undefined, modifySpecResult: ModifySpecResult) {
    if (!projectId) return { result: `Error: Project ID missing.` };
    if (!modifySpecResult || !modifySpecResult.full_content) return { result: `Error: 'full_content' is missing.` };

    try {
        await updateProjectProposedSpec(projectId, modifySpecResult.full_content);
        return {
            result: `Specification update successfully generated.\n${modifySpecResult.reason}`,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            result: `Error updating spec: ${errorMessage}`,
        };
    }
}


/**
 * Retrieves the current spec and proposed spec for a given project.
 * @param projectId The ID of the project.
 * @returns A promise resolving to an object containing spec and proposed_spec strings (or undefined).
 */
async function getProjectSpecs(
  projectId: string
): Promise<{ spec: string | undefined; proposed_spec: string | undefined }> {
  const snapshot = await get(ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`));
  if (!snapshot.exists()) {
    return { spec: undefined, proposed_spec: undefined };
  }
  const metadata = snapshot.val();
  return {
    spec: metadata.spec,
    proposed_spec: metadata.proposed_spec,
  };
}

/**
 * Retrieves the githubUrl for a given project.
 * @param projectId The ID of the project.
 * @returns A promise resolving to an object containing the githubUrl string (or undefined).
 */
async function getProjectMetadata(
  projectId: string
): Promise<{ githubUrl: string | undefined }> {
  const snapshot = await get(ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`));
  if (!snapshot.exists()) {
    return { githubUrl: undefined };
  }
  const metadata = snapshot.val();
  return {
    githubUrl: metadata.githubUrl,
  };
}

/**
 * Updates the proposed_spec field for a given project.
 * @param projectId The ID of the project.
 * @param newProposedSpec The new proposed specification string.
 */
async function updateProjectProposedSpec(
  projectId: string,
  newProposedSpec: string | null
): Promise<void> {
    const metadataRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`);
        await update(metadataRef, {
            proposed_spec: newProposedSpec
        });
}

/**
 * Promotes the proposed_spec to the spec field and clears proposed_spec.
 * @param projectId The ID of the project.
 */
export async function acceptSpecProposal(projectId: string): Promise<void> {
  const { proposed_spec } = await getProjectSpecs(projectId);

  if (!proposed_spec) {
    console.warn(`Project ${projectId} has no proposed spec to accept.`);
    return;
  }

  const metadataRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`);
  
  // ATOMIC UPDATE: Move proposal to spec, clear proposal
  await update(metadataRef, {
      spec: proposed_spec,
      proposed_spec: null 
  });
}

/**
 * Clears the proposed_spec field, rejecting the proposal.
 * @param projectId The ID of the project.
 */
export async function rejectSpecProposal(projectId: string): Promise<void> {
  updateProjectProposedSpec(projectId, null);
}