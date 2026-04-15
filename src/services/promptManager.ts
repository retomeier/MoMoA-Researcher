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

import path from 'path';
import { promises as fs } from 'fs';
import matter from 'gray-matter';
import { toKebabCase } from '../utils/markdownUtils.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the base path for prompts
const PROMPTS_BASE_PATH = path.join(__dirname, '..', 'assets', 'prompts');

// Type definitions for prompt data
interface PromptMetadata {
  name?: string;
  temperature?: number;
  model?: string;
  tools?: string;
}

interface PromptObject {
  content: string;
  metadata: PromptMetadata;
}

// In-memory store for raw and resolved prompts
const rawPrompts = new Map<string, PromptObject>();
const resolvedPrompts = new Map<string, PromptObject>();

/**
 * Recursively scans a directory for Markdown files, parses them, and stores their content and metadata.
 * @param directory The directory to scan.
 * @param relativePath The path relative to PROMPTS_BASE_PATH for generating keys.
 */
async function loadPromptsRecursive(directory: string, relativePath: string = ''): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const currentRelativePath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      await loadPromptsRecursive(fullPath, currentRelativePath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const fileContent = await fs.readFile(fullPath, 'utf-8');
      const { content, data } = matter(fileContent);
      const promptKey = currentRelativePath.replace(/\.md$/, '');

      rawPrompts.set(promptKey, { content, metadata: data as PromptMetadata });
    }
  }
}

/**
 * Resolves placeholders in prompt content.
 * @param content The prompt content with placeholders.
 * @param visited A set to detect circular dependencies.
 * @returns The content with all internal placeholders resolved.
 */
function resolvePlaceholders(content: string, visited: Set<string>): string {
  // Regex to find ${variable_name}
  return content.replace(/\$\{([a-zA-Z0-9_\-/]+)\}/g, (match, key) => {
    if (visited.has(key)) {
      throw new Error(`Circular dependency detected for prompt key: ${key}`);
    }

    const referencedPrompt = rawPrompts.get(key);
    if (!referencedPrompt) {
      // If a prompt isn't found, it might be a runtime placeholder, leave it as is for now.
      // This function only resolves internal dependencies, runtime ones are handled later.
      return match;
    }

    visited.add(key);
    const resolvedContent = resolvePlaceholders(referencedPrompt.content, visited);
    visited.delete(key); // Remove from visited after resolution
    return resolvedContent;
  });
}

/**
 * Initializes the prompt loading and dependency resolution process.
 * This is now an internal function called once when the module is loaded.
 */
async function initialize(): Promise<void> {
  if (resolvedPrompts.size > 0) {
    // Prompts already initialized, do nothing
    return;
  }
  await loadPromptsRecursive(PROMPTS_BASE_PATH);

  // Deep copy rawPrompts to resolvedPrompts to ensure immutability during resolution
  for (const [key, prompt] of rawPrompts.entries()) {
    resolvedPrompts.set(key, { ...prompt });
  }

  // Stage 2: Resolve dependencies
  for (const [key, prompt] of resolvedPrompts.entries()) {
    try {
      const resolvedContent = resolvePlaceholders(prompt.content, new Set([key]));
      resolvedPrompts.set(key, { ...prompt, content: resolvedContent });
    } catch (error) {
      console.error(`Error resolving prompt '${key}':`, error);
      throw error;
    }
  }
}

// This promise represents the module's initialization state.
// It's triggered the first time this module is imported.
const ready = initialize();

/**
 * Takes a string and resolves placeholders that refer to the content of
 * already-initialized prompts.
 *
 * @param content The string content which may contain placeholders like `${prompt_key}`.
 * @returns The content with placeholders substituted with the final, resolved prompt content.
 */
export async function resolvePlaceholdersFromFiles(content: string): Promise<string> {
  await ready;
  // Regex to find all instances of ${prompt_key}
  return content.replace(/\$\{([a-zA-Z0-9_\-/]+)\}/g, (match, key) => {
    // Look up the key in the map of ALREADY RESOLVED prompts.
    const referencedPrompt = resolvedPrompts.get(key);

    // If the prompt exists, return its content.
    // If not, it might be a different type of placeholder (e.g., for runtime data),
    // so we leave it untouched by returning the original match.
    return referencedPrompt ? referencedPrompt.content : match;
  });
}

export async function hasExpertPrompt(name: string): Promise<boolean> {
  await ready;
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('experts/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Retrieves an expert prompt and its metadata.
 * @param name The 'name' field from the expert's front matter (e.g., "Creative Programmer").
 * @returns An object containing the prompt preamble, temperature, and model.
 * @throws Error if the expert prompt is not found.
 */
export async function getExpertPrompt(name: string): Promise<{ preamble: string; temperature: number; model: string | undefined; }> {
  await ready;
  // Find the expert by its 'name' metadata field
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('experts/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return {
        preamble: prompt.content,
        temperature: prompt.metadata.temperature ?? 3, // Default temperature if not specified
        model: prompt.metadata.model ?? undefined, // Default model if not specified
      };
    }
  }
  throw new Error(`Expert prompt with name "${name}" not found.`);
}

/**
 * Retrieves a work phase prompt and its metadata.
 * @param name The 'name' field from the work phase's front matter.
 * @returns An object containing the prompt preamble, temperature, and model.
 * @throws Error if the work phase prompt is not found.
 */
export async function getWorkPhasePrompt(name: string): Promise<{ preamble: string; temperature: number; model: string | undefined; tools: string | undefined }> {
  await ready;
  // Find the work phase by its 'name' metadata field
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('workphases/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return {
        preamble: prompt.content,
        temperature: prompt.metadata.temperature ?? 3, // Default temperature if not specified
        model: prompt.metadata.model ?? undefined, // Default model if not specified
        tools: prompt.metadata.tools ?? undefined
      };
    }
  }
  throw new Error(`Work phase prompt with name "${name}" not found.`);
}

/**
 * Retrieves a tool instruction prompt and its metadata.
 * @param name The 'name' field from the tool instruction's front matter.
 * @returns The content of the named string.
 * @throws Error if the work phase prompt is not found.
 */
export async function getTooInstructionPrompt(name: string): Promise<string> {
  await ready;
  // Find the tool instruction by its 'name' metadata field
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('tool-instructions/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return prompt.content;
    }
  }
  throw new Error(`Tool instruction prompt with name "${name}" not found.`);
}

/**
 * Retrieves a tool instruction prompt and its metadata.
 * @param name The 'name' field from the tool instruction's front matter.
 * @returns The content of the named string.
 * @throws Error if the work phase prompt is not found.
 */
export async function getToolPreamblePrompt(name: string): Promise<string> {
  await ready;
  // Find the tool instruction by its 'name' metadata field
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('tool-preambles/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return prompt.content;
    }
  }
  throw new Error(`Tool preamble with name "${name}" not found.`);
}

/**
 * Retrieves a named string.
 * @param name The 'name' field from the string's front matter.
 * @returns The content of the named string.
 * @throws Error if the named string is not found.
 */
export async function getAssetString(name: string): Promise<string> {
  await ready;
  // Find the string by its 'name' metadata field
  for (const [key, prompt] of resolvedPrompts.entries()) {
    if (key.startsWith('strings/') && toKebabCase(prompt.metadata.name) === toKebabCase(name)) {
      return prompt.content;
    }
  }
  throw new Error(`String with name "${name}" not found.`);
}

/**
 * Replaces runtime placeholders in a given prompt string.
 * This function should be called after internal dependencies are resolved.
 * @param prompt The prompt string with runtime placeholders (e.g., `${runtimeVar}`).
 * @param replacements A map of placeholder names to their replacement values.
 * @returns The prompt string with runtime placeholders replaced.
 */
export async function replaceRuntimePlaceholders(prompt: string, replacements: Record<string, string>): Promise<string> {
  await ready;
  return prompt.replace(/\$\{(\w+)\}/g, (match, placeholderName) => {
    // Only replace if the placeholder is found in the replacements map.
    // Otherwise, leave it as is.
    return replacements[placeholderName] !== undefined ? replacements[placeholderName] : match;
  });
}

/**
 * FOR TESTING PURPOSES ONLY.
 * Provides access to internal state and reset functionality for test isolation.
 * @internal
 */
export const _internal = {
  /** Provides access to the internal rawPrompts map. */
  get rawPrompts() {
    return rawPrompts;
  },
  /** Provides access to the internal resolvedPrompts map. */
  get resolvedPrompts() {
    return resolvedPrompts;
  },
  /** Clears all internal prompt caches. */
  reset: () => {
    rawPrompts.clear();
    resolvedPrompts.clear();
  },
};
