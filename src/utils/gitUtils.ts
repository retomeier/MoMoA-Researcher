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

import * as fs from "fs"; 
import * as path from "path";
import { tmpdir } from "node:os";
import { simpleGit, SimpleGit } from "simple-git";
import { isBinaryFileSync } from "isbinaryfile";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

/**
 * Checks if a directory is within a git repository
 * @param directory The directory to check
 * @returns true if the directory is in a git repository, false otherwise
 */
export function isGitRepository(directory: string): boolean {
  try {
    let currentDir = path.resolve(directory);

    while (true) {
      const gitDir = path.join(currentDir, ".git");

      // Check if .git exists (either as directory or file for worktrees)
      if (fs.existsSync(gitDir)) {
        return true;
      }

      const parentDir = path.dirname(currentDir);

      // If we've reached the root directory, stop searching
      if (parentDir === currentDir) {
        break;
      }

      currentDir = parentDir;
    }

    return false;
  } catch (_error) {
    // If any filesystem error occurs, assume not a git repo
    return false;
  }
}

/**
 * Finds the root directory of a git repository
 * @param directory Starting directory to search from
 * @returns The git repository root path, or null if not in a git repository
 */
export function findGitRoot(directory: string): string | null {
  try {
    let currentDir = path.resolve(directory);

    while (true) {
      const gitDir = path.join(currentDir, ".git");

      if (fs.existsSync(gitDir)) {
        return currentDir;
      }

      const parentDir = path.dirname(currentDir);

      if (parentDir === currentDir) {
        break;
      }

      currentDir = parentDir;
    }

    return null;
  } catch (_error) {
    return null;
  }
}

const LARGE_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB

export async function cloneRepoIntoMemory({
  repoUrl,
  githubToken,
  fileMap,
  binaryFileMap,
}: {
  repoUrl: string;
  githubToken: string;
  fileMap: Map<string, string>;
  binaryFileMap: Map<string, string>;
}): Promise<Array<{ path: string; comment?: string }>> {
  // 1. Parse the branch and clean the repo URL
  let rawRepoUrl = repoUrl.trim();
  let branch: string | undefined;

  if (rawRepoUrl.includes("#")) {
    const parts = rawRepoUrl.split("#");
    rawRepoUrl = parts[0]; // The URL part
    branch = parts[1];     // The Branch part
  }

  const repo = rawRepoUrl
    .replace(/^https:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "");
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "jules-clone-"));
  try {
    const git: SimpleGit = simpleGit(tempDir);
    githubToken = githubToken || process.env.GITHUB_TOKEN || "";
    if (!githubToken) {
      throw new Error(
        "GITHUB_TOKEN environment variable not set. It is required for private repositories."
      );
    }
    const cloneUrl = `https://${githubToken}@github.com/${repo}.git`;
    
    // 2. Prepare clone options. If a branch was found, add the --branch flag.
    const cloneOptions = branch ? ["--branch", branch] : [];

    // 3. Pass options to the clone command
    await git.clone(cloneUrl, tempDir, cloneOptions);

    const allFiles = await git.raw(["ls-files"]);
    const fileList = allFiles.split("\n").filter((f) => f.trim().length > 0);
    const result: Array<{ path: string; comment?: string }> = [];
    for (const filePath of fileList) {
      const fullPath = path.join(tempDir, filePath);
      const stats = fs.statSync(fullPath);
      if (stats.size > LARGE_FILE_SIZE_LIMIT_BYTES) {
        // skip large files
        result.push({ path: filePath, comment: `Skipped (file too large)` });
        continue;
      }
      if (isBinaryFileSync(fullPath)) {
        // Treat files larger than 5MB as binary
        const content = fs.readFileSync(fullPath);
        binaryFileMap.set(filePath, content.toString("base64"));
        result.push({ path: filePath, comment: `Binary` });
      } else {
        const content = fs.readFileSync(fullPath, "utf-8");
        fileMap.set(filePath, content);
        result.push({ path: filePath });
      }
    }
    return result;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function decodeGitBinaries(
  binaryPatches: string[],
  filenamesToExtract: string[]
): Promise<Map<string, string>> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'jules-bin-'));
  const decodedBinaries = new Map<string, string>();

  try {
    const git = simpleGit(tempDir);
    await git.init(); // Create dummy repo
    
    // Write all accepted binary patches into one file
    const combinedPatch = binaryPatches.join('\n');
    const patchPath = path.join(tempDir, 'binary.patch');
    await writeFile(patchPath, combinedPatch);

    // Apply the binary patch
    await git.raw(['apply', '--binary', 'binary.patch']);

    // Read the successfully created files back into memory
    for (const filename of filenamesToExtract) {
      try {
         const extractedPath = path.join(tempDir, filename);
         const fileBuffer = await readFile(extractedPath);
         decodedBinaries.set(filename, fileBuffer.toString('base64'));
      } catch (e) {
         console.error(`Failed to read extracted binary: ${filename}`, e);
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  return decodedBinaries;
}

export async function applyGitPatchWithBinaries(
  patchString: string, 
  _existingFiles: Map<string, string> // To provide context for text changes in the same patch
): Promise<Map<string, string>> {
  const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'jules-patch-'));
  const extractedBinaries = new Map<string, string>();

  try {
    const git = simpleGit(tempDir);
    await git.init(); // Initialize a dummy repo so git apply works smoothly

    // 1. Write the patch file to disk
    const patchPath = path.join(tempDir, 'changes.patch');
    await fs.promises.writeFile(patchPath, patchString);

    // 2. Apply the patch 
    // We use --unidiff-zero in case of context mismatches, and --whitespace=nowarn
    await git.raw(['apply', '--binary', 'changes.patch']);

    // 3. Scan the temp directory for the generated files
    // (You could also parse the patchString to know exactly which filenames to look for)
    const filesInTemp = await fs.promises.readdir(tempDir, { recursive: true });
    
    for (const file of filesInTemp) {
      const fullPath = path.join(tempDir, file);
      const stat = await fs.promises.stat(fullPath);
      
      if (stat.isFile() && file !== 'changes.patch' && !file.startsWith('.git')) {
        // Read the generated binary file
        const fileBuffer = await fs.promises.readFile(fullPath);
        extractedBinaries.set(file, fileBuffer.toString('base64'));
      }
    }
  } catch (error) {
    console.error("Failed to apply Git binary patch:", error);
  } finally {
    // 4. Clean up the temp directory immediately
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }

  return extractedBinaries;
}