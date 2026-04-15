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

import { DEFAULT_GEMINI_LITE_MODEL } from "../config/models.js";
import { FileSummary, InfrastructureContext } from "../momoa_core/types.js";
import { GeminiClient } from "../services/geminiClient.js";
import { getAssetString, replaceRuntimePlaceholders } from "../services/promptManager.js";
import { getLockFileFileDescription, isLockFile } from "./diffGenerator.js";
import { removeBacktickFences, repairTruncatedJsonArray, toKebabCase } from "./markdownUtils.js";
import { TaskRelevantFile, analyzeRelevantFilesForTask } from "./taskFileAnalyzer.js";

/*
 * Maximum file size (100KB, 102400 bytes) for non-source code files allowed for analysis.
 * Files larger than this limit will be skipped.
 */
export const MAX_ANALYSIS_FILE_SIZE_BYTES = 102400;

export const HAS_FUNCTIONS_EXTENSIONS = new Set([
  // Code
  '.ts', '.js', '.tsx', '.jsx',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rb', '.php', '.swift',
  '.kt', '.kts', '.rs', '.m', '.pl', '.lua',
  '.dart', '.fs', '.fsx', '.scala', '.ex', '.exs',
  '.erl', '.hrl', '.elm', '.clj', '.cljs', '.cljc']);

export const SOURCE_CODE_EXTENSIONS = new Set([
  // Code
  '.ts', '.js', '.tsx', '.jsx',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rb', '.php', '.swift',
  '.kt', '.kts', '.rs', '.m', '.pl', '.lua',
  '.dart', '.fs', '.fsx', '.scala', '.ex', '.exs',
  '.erl', '.hrl', '.elm', '.clj', '.cljs', '.cljc',

  // Web & Markup
  '.html', '.css', '.scss', '.less',
  '.xml', '.svg',

  // Markdown
  '.md', '.markdown',

  // Config & Data
  '.json', '.yml', '.yaml',
  '.ini', '.toml', '.properties', '.env',
  '.dockerfile', 'Dockerfile',
  '.sh', '.bash', '.ps1',
  '.sql',

  // Dotfiles
  '.gitignore', '.dockerignore', '.prettierrc', '.eslintrc',
  '.babelrc', '.npmrc', '.editorconfig', '.gitattributes',
]);

/**
 * Helper to get the basename (e.g., 'src/file.txt' -> 'file.txt')
 */
function getBasename(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return filename.substring(lastSlash + 1);
}

/**
 * Helper to get extension, handling dotfiles
 * e.g., 'src/file.txt' -> '.txt'
 * e.g., 'src/config/.gitignore' -> '.gitignore'
 * e.g., 'Dockerfile' -> 'Dockerfile'
 * e.g., 'Makefile' -> 'no-extension'
 */
export function getFileExtension(filename: string): string {
  const basename = getBasename(filename);

  // Handle special case for 'Dockerfile' name
  if (basename === 'Dockerfile') {
    return 'Dockerfile';
  }

  const lastDot = basename.lastIndexOf('.');

  // No dot: 'Makefile', 'LICENSE'
  if (lastDot === -1) {
    return 'no-extension';
  }
  
  // Dot is first char: '.gitignore', '.env'
  if (lastDot === 0) {
    return basename;
  }
  
  // Standard extension: 'file.txt' -> '.txt'
  return basename.substring(lastDot);
}

const fileAnalysis: Map<string, FileSummary> = new Map<string, FileSummary>();
let projectName;

let taskRelevantFiles: TaskRelevantFile[] = [];
let dynamicallyAddedRelevantFiles: Set<string> = new Set();

/**
 * Analyzes project files to gather insights, such as dependencies or code structure.
 * Supports an optional binaryFileMap to include binary files in the analysis context.
 */
export async function analyzeFiles(
  fileMap: Map<string, string>, 
  binaryFileMapOrClient?: Map<string, string> | GeminiClient,
  multiAgentGeminiClient?: GeminiClient
): Promise<void> {
  fileAnalysis.clear();
  taskRelevantFiles = [];
  dynamicallyAddedRelevantFiles.clear();

  let binaryFileMap = new Map<string, string>();
  let client = multiAgentGeminiClient;

  // Handle flexible arguments to support legacy callers (fileMap, client)
  if (binaryFileMapOrClient) {
    // Check if the second argument is a Map (binaryFileMap) or a Client
    if ('entries' in binaryFileMapOrClient && typeof (binaryFileMapOrClient as Map<string, unknown>).entries === 'function') {
      binaryFileMap = binaryFileMapOrClient as Map<string, string>;
    } else {
      client = binaryFileMapOrClient as GeminiClient;
    }
  }

  // 1. Process Text Files
  for (const filename of fileMap.keys()) {
    fileAnalysis.set(filename, {
      filename: filename,
    });
  }

  // 2. Process Binary Files
  for (const filename of binaryFileMap.keys()) {
    fileAnalysis.set(filename, {
      filename: filename,
      description: "Binary file",
    });
  }

  if (client)
    await refreshProjectName(client);
}

export function removeFileEntry(filename: string) {
  const isTaskRelevant = taskRelevantFiles.some(f => f.filename === filename);
  const isDynamicallyRelevant = dynamicallyAddedRelevantFiles.has(filename);

  if (isTaskRelevant || isDynamicallyRelevant) {
    // 1. Update the task-relevant list (if it's in there)
    const taskEntry = taskRelevantFiles.find(f => f.filename === filename);
    if (taskEntry) {
      taskEntry.description = "---DELETED---";
    }

    // 2. Update the master analysis map
    let summary = fileAnalysis.get(filename);
    if (!summary) {
      summary = { filename };
    }
    summary.description = "---DELETED---";
    summary.relatedFiles = ""; // Clear related files
    fileAnalysis.set(filename, summary);

  } else {
    // This file wasn't relevant, so just delete it from the master map.
    let summary = fileAnalysis.get(filename);
    if (!summary) {
      summary = { filename };
    }
    summary.description = "---DELETED---";
    summary.relatedFiles = ""; // Clear related files
    fileAnalysis.set(filename, summary);
  }

  for (const summary of fileAnalysis.values()) {
    if (summary.relatedFiles) {
      const related = summary.relatedFiles.split('\n');
      const updatedRelated = related.filter(file => file.trim() !== filename);
      summary.relatedFiles = updatedRelated.join('\n');
    }
  }
}

/**
 * Updates the analysis data for a specific file.
 * @param filename The name of the file to update.
 * @param fileMap The map of all file contents.
 * @param multiAgentGeminiClient The Gemini client for API calls.
 * @param explicitUpdate A specific FileSummary to apply to the file.
 * @param skipAnalysis If true, skips the LLM analysis and only updates the metadata map.
 */
export async function updateFileEntry(filename: string, fileMap: Map<string, string>, multiAgentGeminiClient?: GeminiClient, explicitUpdate?: FileSummary, skipAnalysis: boolean = false): Promise<FileSummary | undefined> {
  if (isLockFile(filename)) {
    const lockFileSummary: FileSummary = {
        filename: filename,
        description: getLockFileFileDescription(),
        relatedFiles: ""
    };
    fileAnalysis.set(filename, lockFileSummary);
    return lockFileSummary;
  }

  if (explicitUpdate) {
    fileAnalysis.set(filename, explicitUpdate);
    return explicitUpdate;
  }

  if (skipAnalysis) {
    const existingValue = fileAnalysis.get(filename);
    return existingValue;
  }

  if (!multiAgentGeminiClient) {
    const basicFileSummary: FileSummary = explicitUpdate ?? { filename };
    fileAnalysis.set(filename, basicFileSummary);
    return basicFileSummary;
  }

  const filesToProcessSet = new Set<string>();
  filesToProcessSet.add(filename); 

  const existingFileEntry = fileAnalysis.get(filename);
  if (existingFileEntry?.relatedFiles)
    parseFilenamesList(existingFileEntry.relatedFiles).forEach((relatedFilename: string) => filesToProcessSet.add(relatedFilename));

  let analysisResults: Map<string, FileSummary> | undefined;
  try {
    analysisResults = await doFileAnalysis(filesToProcessSet, fileMap, multiAgentGeminiClient);
  } catch {
    return undefined;
  }

  if (analysisResults) {
    const shouldRefreshProjectName = analysisResults.size > fileAnalysis.size;

    const updatedEntry: FileSummary | undefined = analysisResults.get(filename);
    if (updatedEntry) {
      fileAnalysis.set(filename, updatedEntry);

      // 2. ALSO update the task-relevant list if this file is in it.
      // This will overwrite "---DELETED---" or any stale description.
      const taskRelevantEntry = taskRelevantFiles.find(f => f.filename === filename);
      if (taskRelevantEntry && updatedEntry.description) {
        taskRelevantEntry.description = updatedEntry.description;
      } else if (taskRelevantEntry?.description === "---DELETED---") {
        if (taskRelevantEntry)
          taskRelevantEntry.description = "";
      }
    }

    for (const [filename, fileSummary] of analysisResults.entries())
      if (!fileAnalysis.has(filename))
        fileAnalysis.set(filename, fileSummary);

    try {
      if (shouldRefreshProjectName)
        await refreshProjectName(multiAgentGeminiClient);
    } catch {}

    return updatedEntry;
  }
  return undefined;
}

/**
 * Runs the task-specific file analyzer and stores the results.
 * This should be called once by the Orchestrator at the start.
 */
export async function analyzeAndSetTaskRelevantFiles(
  taskDescription: string,
  assumptions: string,
  fileMap: Map<string, string>,
  binaryFileMap: Map<string, string>,
  infrastructureContext: InfrastructureContext,
  multiAgentGeminiClient: GeminiClient,
  sendMessage: (message: string) => void,
  image?: string, 
  imageMimeType?: string
): Promise<void> {
  // Call the analyzer
  taskRelevantFiles = await analyzeRelevantFilesForTask(
    taskDescription,
    assumptions,
    fileMap,
    binaryFileMap,
    infrastructureContext,
    multiAgentGeminiClient,
    sendMessage,
    image, 
    imageMimeType,
  );
  // Clear dynamic files as this is a new "base list"
  dynamicallyAddedRelevantFiles.clear();
}

/**
 * Adds a file to the list of dynamically relevant files,
 * typically after it has been read or edited.
 */
export function addDynamicallyRelevantFile(filename: string): void {
  if (!filename) return;

  // Check if it's already in the main task-relevant list
  const isAlreadyTaskRelevant = taskRelevantFiles.some(file => file.filename === filename);
  if (isAlreadyTaskRelevant) {
    return;
  }

  // Add to the dynamic set
  dynamicallyAddedRelevantFiles.add(filename);
}

/**
 * Generates a consolidated string of task-relevant files, folder structure,
 * and a summary of other files, replacing the old getFileDescriptions
 * for agent context.
 * @returns A single string for the context.
 */
export function getTaskRelevantFileDescriptions(): string {
  const lines: string[] = [];
  
  // --- 1. Format Task-Relevant Files ---
  if (taskRelevantFiles.length > 0) {
    lines.push('##Project Files');
    lines.push('**Likely Task-Relevant Files:**');
    lines.push('_Based on a preliminary analysis based on the Project Definition, these files seem likely to be relevant to this project:_');
    for (const file of taskRelevantFiles) {
      lines.push(`${file.filename}`);
      if (file.description)
        lines.push(`"${file.description}"`);
      else
        lines.push(`---No file description available---`);
    }
  }

  // --- 2. Format Dynamically Added Files ---
  const dynamicFilesToShow: string[] = [];
  for (const filename of dynamicallyAddedRelevantFiles) {
    // Check it wasn't in the original list
    if (!taskRelevantFiles.some(f => f.filename === filename)) {
      dynamicFilesToShow.push(filename);
    }
  }

  if (dynamicFilesToShow.length > 0) {
    lines.push('');
    lines.push('**Files Read / Edited / Created / Deleted:**');
    lines.push('_These files have been read, edited, created, or reverted during this project:_');
    dynamicFilesToShow.sort();
    for (const filename of dynamicFilesToShow) {
      const summary = fileAnalysis.get(filename);
      lines.push(`${filename}`);
      // Use the description from the analysis map, if it exists
      if (summary?.description) {
        lines.push(`> ${summary.description}`);
      }
    }
  }

  // --- 3. Generate Folder Structure ---
  const folderPaths = new Set<string>();
  for (const filepath of fileAnalysis.keys()) {
    const parts = filepath.split('/');
    if (parts.length > 1) {
      parts.pop();
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        folderPaths.add(currentPath);
      }
    }
  }

  if (folderPaths.size > 0) {
    lines.push('');
    lines.push('**Project Folder Structure:**');
    const sortedFolders = Array.from(folderPaths).sort();
    lines.push(sortedFolders.map(f => `* ${f}/`).join('\n'));
  }

  // --- 4. Generate "Other Files" Summary ---
  const otherFileExtCounts = new Map<string, number>();
  const allRelevantFiles = new Set([
    ...taskRelevantFiles.map(f => f.filename),
    ...dynamicallyAddedRelevantFiles
  ]);

  for (const summary of fileAnalysis.values()) {
    if (!summary?.filename) continue;
    
    // Skip if it's already listed as relevant
    if (allRelevantFiles.has(summary.filename)) continue;

    const ext = getFileExtension(summary.filename);

    otherFileExtCounts.set(ext, (otherFileExtCounts.get(ext) || 0) + 1);
  }

  if (otherFileExtCounts.size > 0) {
    lines.push('');
    lines.push('**Summary of All Other Files (by extension):**');
    const sortedExts = Array.from(otherFileExtCounts.keys()).sort();
    
    for (const ext of sortedExts) {
      const count = otherFileExtCounts.get(ext)!;
      const plural = count === 1 ? 'file' : 'files';
      
      if (ext === 'no-extension') {
        lines.push(`* ${count} ${plural} with no extension`);
      } else {
        lines.push(`* ${count} ${ext} ${plural}`);
      }
    }
  }

  const finalList = lines.join('\n').trim();
  // Provide a fallback message if all files were relevant
  if (finalList.length === 0 && fileAnalysis.size > 0) {
    return '##All files in the project were listed as relevant.';
  }

  return finalList.length > 0 ? finalList : '--No files available--';
}

export function getFileAnalysis(filename: string): FileSummary | undefined {
  return fileAnalysis.get(filename);
}

/**
 * Generates a consolidated string of file descriptions, separating source/markdown
 * from a summary of other files.
 * @returns A single string containing descriptions of all analyzed files.
 */
export function getFileDescriptions(): string {
  const lines: string[] = [];
  const sourceCodeFiles: FileSummary[] = [];
  const otherFileExtCounts = new Map<string, number>();

  // --- 1. Categorize files ---
  for (const summary of fileAnalysis.values()) {

    if (!summary?.filename) {
      continue;
    }

    const ext = getFileExtension(summary.filename);

    if (SOURCE_CODE_EXTENSIONS.has(ext)) {
      sourceCodeFiles.push(summary);
    } else {
      // Add to 'other' summary count
      otherFileExtCounts.set(ext, (otherFileExtCounts.get(ext) || 0) + 1);
    }
  }

  // --- 2. Helper to format a file summary entry ---
  const formatSummary = (summary: FileSummary) => {
    const summaryLines: string[] = [];
    summaryLines.push(`${summary.filename}`);
    if (summary.description?.trim()) {
      summaryLines.push(`${summary.description}`);
    }

    summaryLines.push(''); // Add blank line after entry
    return summaryLines.join('\n');
  };

  // --- 3. Process Source Code & Config Files ---
  if (sourceCodeFiles.length > 0) {
    lines.push('##Source Code, Config Files, and Markdown (not exclusive)');
    // Sort for consistent ordering
    sourceCodeFiles.sort((a, b) => a.filename.localeCompare(b.filename));
    for (const summary of sourceCodeFiles) {
      lines.push(formatSummary(summary));
    }
  }

  // --- 5. Process and Summarize Other Files ---
  if (otherFileExtCounts.size > 0) {
    lines.push('##Summary of Other Available Files');
    const sortedExts = Array.from(otherFileExtCounts.keys()).sort();
    
    for (const ext of sortedExts) {
      const count = otherFileExtCounts.get(ext)!;
      const plural = count === 1 ? 'file' : 'files';
      
      if (ext === 'no-extension') {
        lines.push(`* ${count} ${plural} with no extension`);
      } else {
        lines.push(`* ${count} ${ext} ${plural}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Searches for a query within file contents and filenames.
 *
 * @param fileMap A Map of file paths to their string contents.
 * @param query The string to search for.
 * @returns An array of strings of file / filenames containing a match.
 */
export function findInFiles(
  query: string,  
  fileMap: Map<string, string>,
): string[] {
    const results: string[] = [];

    for (const [filePath, fileContent] of fileMap.entries()) {
      if (filePath.includes(query) || fileContent.includes(query))
        results.push(filePath)
    }

    return results;
  }

/**
 * Generates a markdown-formatted string listing available file names.
 * @param returnUndefinedIfNone If true, returns undefined when the map is empty.
 * @returns A formatted string of filenames, or undefined if the map is empty and the flag is set.
 */
export function getFilesDocsListString(
  fileContentMap: Map<string, unknown> | undefined,
  returnUndefinedIfNone?: boolean
): string | undefined {
  if (!fileContentMap || fileContentMap.size === 0) {
    return returnUndefinedIfNone
      ? undefined
      : "* **Available Files:**\n---No files are currently available---";
  }

  const fileList = Array.from(fileContentMap.keys())
    .map(name => `  * ${name}`)
    .join('\n');

  return `* **Available Files:**\n${fileList}`;
}

/**
 * Determines the project name, falling back to a random word if it cannot be derived.
 * In a real scenario, this might involve an LLM call or parsing a project file.
 * @returns The determined or generated project name.
 */
export async function getProjectName(multiAgentGeminiClient?: GeminiClient): Promise<string | undefined> {
  if (projectName)
    return projectName;

  if (multiAgentGeminiClient)
    return await refreshProjectName(multiAgentGeminiClient);
  else
    return undefined
}

/**
 * Helper function to parse a newline-separated string into an array of cleaned filenames.
 * @param {string} filenamesString The string containing newline-separated filenames.
 * @returns {string[]} An array of cleaned filenames.
 */
function parseFilenamesList(filenamesString: string): string[] {
  if (!filenamesString.trim()) {
    return [];
  }

  return filenamesString.split('\n')
                        .map(name => name.trim())
                        .filter(name => name !== '');
}

async function doFileAnalysis(filesToAnalyze: Set<string>, fileMap: Map<string, string>, multiAgentGeminiClient: GeminiClient): Promise<Map<string, FileSummary>> {
  const allFileSummaries = new Map<string, FileSummary>();

  const initialPromptTemplate = await getAssetString('code-search-analysis');

  const filesForAnalysis = [...filesToAnalyze]
    .map(filename =>
`Filename: **${filename}**
\`\`\`
${fileMap.get(filename) || '[Content not found]'}
\`\`\``)
    .join('\n\n');

  let eachPrompt = await replaceRuntimePlaceholders(initialPromptTemplate,
    {
      PreviousJSON: "--No Previously processed data--",
      FileNameList: getFilesDocsListString(fileMap, false) ?? '* **Available Files:**\n---No files are currently available---',
      FilesForAnalysis: filesForAnalysis
    }
  );

  let analysisResult: string | undefined = (await multiAgentGeminiClient.sendOneShotMessage(
    eachPrompt,
    { model: DEFAULT_GEMINI_LITE_MODEL } 
  ))?.text?.trim() || '';

  try {
    analysisResult = removeBacktickFences(analysisResult);
    const repairedAnalysisResult = repairTruncatedJsonArray(analysisResult);

    if (repairedAnalysisResult) {
      let fileSummaries: FileSummary[] = JSON.parse(repairedAnalysisResult);
      for (const summary of fileSummaries) {
        if (summary.filename && typeof summary.filename === 'string') {
          allFileSummaries.set(summary.filename, summary);
        } else {
          console.warn("doFileAnalysis: Received a file summary object from LLM without a valid filename. Discarding entry:", summary);
        }
      }
    }
  } catch (error: any) {
      console.error(`doFileAnalysis: Failed to parse LLM response: ${error.message}`, analysisResult);
  }

  return allFileSummaries;
}

async function refreshProjectName(multiAgentGeminiClient: GeminiClient): Promise<string | undefined> {
  const existingProjectNamePromptChunk = projectName ? `We previously derived the project name '${projectName}'. If that is still a reasonable project name, simply return that. If it's very clear that the existing project name is the _wrong_ project name, then return *only* a better and clearly more relevant project name. You MUST NOT replace a random word project name with a different random word. If in doubt, return the existing project name.` : '';

  const fileDescriptions = getFileDescriptions();
  const projectFilesAndDescriptions = fileDescriptions ? `Here are the project files:\n${fileDescriptions}` : `There are currently no files associated with this project.`

  let projectNameDeriverPrompt = `I need a simple, single-word identifier, using kebab-case, to identify this project. The project should have a name already, which you should be able to derive from the folder structure, filenames, and file descriptions.\n\n${projectFilesAndDescriptions}\n\n${existingProjectNamePromptChunk}`
    .trimEnd();

  try {

    let projectNameDeriverResult: string | undefined = (await multiAgentGeminiClient.sendOneShotMessage(
      projectNameDeriverPrompt,
      { model: DEFAULT_GEMINI_LITE_MODEL } 
    ))?.text?.trim() || undefined;
  
    if (projectNameDeriverResult) {
      projectNameDeriverResult = removeBacktickFences(projectNameDeriverResult);
      projectNameDeriverResult = toKebabCase(projectNameDeriverResult);
    
      return projectNameDeriverResult;
    }
  } catch {
    return undefined;
  }
  return undefined;
}