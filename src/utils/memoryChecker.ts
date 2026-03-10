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

import * as os from 'os';

export function checkContainerMemory(): string {
  // Helper to convert bytes to Megabytes
  const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

  // Container/System level memory (What Cloud Run gives you)
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Process level memory (What your Node server is currently eating)
  const procMem = process.memoryUsage();

  let memory = `Total Container  Memory    : ${toMB(totalMem)} MB\n\n`;
  memory +=    `Container Available Memory : ${toMB(freeMem)} MB`;
  return memory;
}