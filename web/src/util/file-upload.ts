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

const IGNORE_PATTERNS: RegExp[] = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.DS_Store$/,
];

export function pickAndLoadFiles(
  folder?: boolean
): Promise<{ path: string; textContent: string }[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    if (folder) {
      input.webkitdirectory = true;
    }
    input.multiple = true;

    input.onchange = async (event: Event) => {
      const files = (event.currentTarget as HTMLInputElement).files || [];
      if (!files) {
        resolve([]);
        return;
      }

      const filePromises = Array.from(files)
        .filter(
          (file) =>
            !IGNORE_PATTERNS.some((pattern) =>
              pattern.test(folder ? file.webkitRelativePath : file.name)
            )
        )
        .map((file) => {
          return new Promise((resolveFile, rejectFile) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolveFile({
                path: folder ? file.webkitRelativePath : file.name,
                textContent: reader.result as string,
              });
            };
            reader.onerror = rejectFile;
            reader.readAsText(file);
          });
        });

      try {
        const fileContents = await Promise.all(filePromises);
        resolve(fileContents as { path: string; textContent: string }[]);
      } catch (error) {
        reject(error);
      }
    };

    input.click();
  });
}

/**
 * Reads a File object, validates it as an image, and converts it to a raw Base64 data string.
 * @param file The File object to process.
 * @returns A Promise that resolves with the Base64 data string (without the MIME type prefix).
 * @throws An error if the file is not an image.
 */
export function fileToBase64Data(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // 1. Validate file type
    if (!file.type.startsWith('image/')) {
      reject(new Error(`File must be an image, but received type: ${file.type}`));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 2. Extract Base64 data part (after the comma)
      const base64Data = dataUrl.split(',')[1];
      if (!base64Data) {
        reject(new Error('Failed to extract Base64 data from file.'));
        return;
      }
      resolve(base64Data);
    };

    reader.onerror = (error) => {
      reject(error);
    };

    // 3. Read file as Data URL
    reader.readAsDataURL(file);
  });
}
