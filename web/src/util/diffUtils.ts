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

import { createTwoFilesPatch } from 'diff';

/**
 * Generates a standard unified diff string showing the changes from originalSpec to proposedSpec.
 * @param originalSpec The original specification string (A).
 * @param proposedSpec The proposed new specification string (B).
 * @returns A unified diff patch string.
 */
export function generateSpecDiff(
  originalSpec: string,
  proposedSpec: string
): string {
  // Use 'diff' library's createTwoFilesPatch to generate a unified diff.
  // We use arbitrary filenames for the diff header, as the content is just the spec.
  const diff = createTwoFilesPatch(
    'current_spec',
    'proposed_spec',
    originalSpec,
    proposedSpec,
    'Current Specification',
    'Proposed Specification'
  );

  // The createTwoFilesPatch function returns a string that includes the header.
  return diff;
}
