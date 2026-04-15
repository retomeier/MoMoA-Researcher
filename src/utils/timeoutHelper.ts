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

export const withDeadline = async <T>(
  promise: Promise<T>, 
  deadlineMs: number | undefined, 
  signal?: AbortSignal
): Promise<T> => {
  // No project deadline
  if (deadlineMs === undefined) {
    if (!signal) return promise;

    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        if (signal.aborted) {
          return reject(new Error("Operation aborted."));
        }
        signal.addEventListener('abort', () => {
          reject(new Error("Operation aborted."));
        });
      })
    ]);
  }

  const remaining = deadlineMs - Date.now();
  
  if (remaining <= 0) throw new Error("Hard time limit reached before tool execution.");

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("Maximum task time limit reached during tool execution. Tool cancelled.")), remaining);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error("Operation aborted."));
      });
    })
  ]);
};