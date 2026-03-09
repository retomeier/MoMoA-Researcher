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

export function normalizeRepoUrl(input: string): {
  url: string;
  org: string;
  repo: string;
} {
  if (!input) {
    return { url: "", org: "", repo: "" };
  }
  let url = input.replace(/\s+/g, '');
  // Remove .git suffix if present
  if (url.endsWith(".git")) {
    url = url.slice(0, -4);
  }
  // Handle SSH URLs
  if (url.startsWith("git@")) {
    const parts = url.split(":");
    if (parts.length === 2) {
      const host = parts[0].slice(4); // remove 'git@'
      const path = parts[1];
      url = `https://${host}/${path}`;
    }
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://github.com/" + url;
  }
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      const org = pathParts[0];
      const repo = pathParts[1];
      return { url: parsedUrl.toString(), org, repo };
    }
  } catch (e) {
    // Invalid URL
  }
  return { url: "", org: "", repo: "" };
}
