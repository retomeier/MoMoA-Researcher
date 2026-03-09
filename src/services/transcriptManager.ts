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

import { TranscriptManagerConfig, 
    FormattedTranscriptEntry, 
    FormattedTranscriptPart, USER_ROLE } from "../momoa_core/types.js";

/**
 * Interface for a single entry in the transcript.
 */
interface TranscriptEntry {
    speaker: string;
    content: string | any[];
    originalContent: string | any[];
    documentId?: string;
    replacementIfSuperseded?: string;
    isSuperseded: boolean; 
    ephemeral?: boolean; 
}

/**
 * Interface for the options parameter in addEntry method.
 */
export interface AddEntryOptions {
    documentId?: string;
    replacementIfSuperseded?: string;
    ephemeral?: boolean;
}

/**
 * @class TranscriptManager
 * @description Manages a transcript of a conversation, with granular handling for versioned documents.
 * Each document version can specify its own replacement text to be used if it's superseded.
 */
export class TranscriptManager {
    private transcript: TranscriptEntry[] = [];
    private readonly config: TranscriptManagerConfig;

    constructor(
        config: TranscriptManagerConfig,
    ) {
        this.config = config;
    }

    /**
     * Initializes the transcript with the initial user prompt and optional image.
     * This should only be called once during construction.
     * @param imagePrompt The initial text prompt from the user.
     * @param image Optional Base64 encoded image data.
     * @param imageMimeType Optional MIME type of the attached image.
     */
     addImage(imagePrompt?: string, image?: string, imageMimeType?: string): void {
        const parts: FormattedTranscriptPart[] = [];

        // 1. Add Image First (Context)
        // Providing the image before the text prompt is standard practice for multimodal models.
        if (image && imageMimeType) {
            parts.push({
                inlineData: {
                    mimeType: imageMimeType, 
                    data: image,
                }
            });
        }

        // 2. Add Text Prompt Second (Question/Instruction)
        if (imagePrompt) {
            parts.push({ text: imagePrompt });
        } else if (parts.length === 0) {
            // Fallback: Ensure we have at least one part if both are missing
            parts.push({ text: '' }); 
        }

        // Add the initial user entry. We use 'user' role defined in types.ts.
        // We use the internal addEntry method to ensure proper TranscriptEntry creation.
        // The initial entry is not ephemeral and does not require special options.
        this.addEntry(USER_ROLE, parts, {}, false);
    }

    /**
     * Adds a new entry to the transcript.
     *
     * If this entry represents a new version of a document (indicated by `options.documentId`),
     * it will mark all previously added, non-superseded versions of the same document as superseded.
     * When an older version is marked as superseded:
     * - Its `isSuperseded` flag is set to true.
     * - If that older version had a `replacementIfSuperseded` text defined at the time it was added,
     * its `content` field will be updated to this specific replacement text.
     * - If it did not have such a text defined, its `content` (which is its original content) remains unchanged,
     * but it's still marked as `isSuperseded`.
     *
     * The new entry itself is added with its own `content`, `documentId` (if any),
     * and its own `replacementIfSuperseded` text (if any, for future use).
     *
     * @param {string} speaker - The identifier of the speaker or entity providing the content. This will be used as 'role'.
     * @param {string} content - The textual content of what was said, or the current version of a document. This will be the element in 'parts'.
     * @param {AddEntryOptions} [options={}] - Optional parameters for the entry.
     * @param {string} [options.documentId] - A unique identifier for the document. If provided,
     * this entry is treated as a version of this document.
     * @param {string} [options.replacementIfSuperseded] - The specific string that THIS entry's `content`
     * should be changed to if a newer version of this same `documentId` is added in the future.
     * @param {boolean} [flipLast=false] - If true, inserts the new entry before any pending user messages.
     */
    addEntry(
        speaker: string,
        content: string | any[],
        options: AddEntryOptions = {},
        flipLast: boolean = false,
    ): void {
        if (typeof speaker !== 'string' || speaker.trim() === '') {
            console.warn('Warning: Speaker identifier is empty or not a string.');
        }
        if (typeof content !== 'string' && !Array.isArray(content)) {
            console.warn('Warning: Content is not a string or array.');
        }

        const { documentId, replacementIfSuperseded, ephemeral } = options;

        // IDEMPOTENCY CHECK:
        // If an entry with this documentId already exists, acts as the same role, 
        // has the EXACT same content, and is currently active (not superseded),
        // we ignore this addition. This prevents "echos" from external syncs.
        if (documentId && typeof documentId === 'string' && documentId.trim() !== '') {
             const exactDuplicate = this.transcript.find(entry => 
                entry.documentId === documentId && 
                !entry.isSuperseded && 
                entry.speaker === speaker &&
                // Use stringify to compare both strings and arrays (tool parts)
                JSON.stringify(entry.content) === JSON.stringify(content)
             );

             if (exactDuplicate) {
                 return;
             }
        }

        const newEntry: TranscriptEntry = {
            speaker: speaker,
            content: content,
            originalContent: content,
            isSuperseded: false,
            ...(ephemeral !== undefined && { ephemeral }),
        };

        if (documentId && typeof documentId === 'string' && documentId.trim() !== '') {
            newEntry.documentId = documentId;

            // Store the replacement rule for this specific version, if provided
            if (typeof replacementIfSuperseded === 'string') {
                newEntry.replacementIfSuperseded = replacementIfSuperseded;
            }

            // Now, iterate through existing entries to supersede older versions of THIS document.
            this.transcript.forEach(entry => {
                // This code will supercede entries of the form "FILENAME:LINT".
                const toolReplace = (entry.documentId && entry.documentId.includes(":") && entry.documentId.split(":", 1)[0] == newEntry.documentId && !entry.isSuperseded);

                if (toolReplace || (entry.documentId === newEntry.documentId && !entry.isSuperseded)) {
                    entry.isSuperseded = true;
                    if (typeof entry.replacementIfSuperseded === 'string') {
                        entry.content = entry.replacementIfSuperseded;
                    }
                }
            });
        }

        if (flipLast) {
            // Define the roles that identify a model response and a pending user message.
            // These could be made configurable (e.g., via class properties or method parameters)
            // to align with getPendingPrompt if it uses dynamic roles.
            const modelRoleForPendingCheck = "model";
            const userRoleForPendingCheck = "user";

            let pendingBlockStartIndex = -1;

            if (this.transcript.length > 0) {
                // A pending prompt can only exist if the last entry is NOT a model response.
                if (this.transcript[this.transcript.length - 1].speaker !== modelRoleForPendingCheck) {
                    let countOfPendingEntries = 0;
                    // Iterate backwards to find the start of the contiguous block of user entries.
                    for (let i = this.transcript.length - 1; i >= 0; i--) {
                        if (this.transcript[i].speaker === userRoleForPendingCheck) {
                            countOfPendingEntries++;
                        } else {
                            // The block of pending user entries ends here.
                            break;
                        }
                    }

                    if (countOfPendingEntries > 0) {
                        pendingBlockStartIndex = this.transcript.length - countOfPendingEntries;
                    }
                }
            }

            if (pendingBlockStartIndex !== -1) {
                // Insert the new entry before the identified block of pending entries.
                this.transcript.splice(pendingBlockStartIndex, 0, newEntry);
            } else {
                // No pending entries were found (or transcript was empty).
                // With `flipLast` now meaning "insert before pending", if that's not possible,
                // the entry is appended. This replaces the old "swap with last" behavior.
                this.transcript.push(newEntry);
            }
        } else { // flipLast is false
            this.transcript.push(newEntry);
        }
    }



    /**
     * @method insertLineAtTop
     * @description Inserts a new line of text at the beginning of the content of a transcript entry identified by its documentId.
     * It iterates through the transcript and prepends the text to the content of any non-superseded entry
     * found that matches the provided documentId.
     *
     * @param {string} identifier - The documentId of the entry to modify. This must be a non-empty string.
     * @param {string} lineToInsert - The new line of text to prepend to the 'content' property.
     */
    insertLineAtTop(identifier: string, lineToInsert: string): void {
        // Ensure identifier is a valid non-empty string before proceeding
        if (typeof identifier !== 'string' || identifier.trim() === '') {
            console.warn('insertLineAtTop called with invalid or empty identifier:', identifier);
            return;
        }
        if (typeof lineToInsert !== 'string') {
            console.warn('insertLineAtTop called with non-string lineToInsert:', lineToInsert);
            return;
        }

        // Iterate through the transcript entries to find the matching documentId
        this.transcript.forEach(entry => {
            // Check if the entry has a documentId, it matches the provided identifier, and it's not superseded
            if (entry.documentId === identifier && !entry.isSuperseded) {
                // Prepend the new line to the entry's content, only if content is string
                if (typeof entry.content === 'string') {
                    entry.content = `${lineToInsert}\n${entry.content}`;
                }
            }
        });
    }

    /**
     * @method replaceEntry
     * @description Replaces the content of a transcript entry identified by its documentId.
     * It iterates through the transcript and replaces the entries found that match the provided documentId.
     * If no entry is found with the specified documentId, the method does nothing.
     *
     * @param {string} identifier - The documentId of the entry to replace. This must be a non-empty string.
     * @param {string} newValue - The new value for the 'content' property of the matching entry.
     */
    replaceEntry(identifier: string, newValue: string): void {
        // Ensure identifier is a valid non-empty string before proceeding
        if (!identifier) {
            return; // Do nothing if identifier is invalid
        }

        // Iterate through the transcript entries to find the matching documentId
        for (let i = 0; i < this.transcript.length; i++) {
            const entry = this.transcript[i];
            // Check if the entry has a documentId property and it matches the provided identifier
            if (entry.documentId === identifier) {
                // Found the entry, update its content with the new value
                entry.content = newValue;
            }
        }
    }

    /**
     * @method supersedeEntry
     * @description Finds all non-superseded entries with a given documentId and marks them as superseded.
     * If an entry has a 'replacementIfSuperseded' text, its content is updated to that text.
     * This method does NOT add a new entry to the transcript.
     *
     * @param {string} identifier - The documentId of the entry/entries to supersede.
     */
    supersedeEntry(identifier: string): void {
        if (typeof identifier !== 'string' || identifier.trim() === '') {
            console.warn('supersedeEntry called with invalid or empty identifier:', identifier);
            return;
        }

        this.transcript.forEach(entry => {
            // Check if the entry matches the documentId and is not already superseded.
            if (entry.documentId === identifier && !entry.isSuperseded) {
                entry.isSuperseded = true;
                // If a specific replacement string was defined for this entry, use it.
                if (typeof entry.replacementIfSuperseded === 'string') {
                    entry.content = entry.replacementIfSuperseded;
                }
            }
        });
    }

    /**
     * Retrieves the transcript, formatting each entry into the specified structure:
     * `{'role': <speaker_identifier>, 'parts': [{'text': <content_string>}]}`.
     * Consecutive entries from the same speaker are merged using a newline character as a separator.
     *
     * If `lastSpeakerRequired` is provided (e.g., 'Model' or 'User'), the returned transcript
     * will be truncated to end with the last consolidated entry from that specified speaker.
     * Any entries that originally followed this last instance of `lastSpeakerRequired` will be ignored.
     * If the `lastSpeakerRequired` is specified but not found in the transcript, an empty array is returned.
     *
     * @param {string} [lastSpeakerRequired] - Optional. The speaker role (e.g., 'Model', 'User')
     * that must be the final speaker in the returned transcript.
     * If falsy (e.g., undefined, null, empty string), this filtering is not applied.
     * @returns {FormattedTranscriptEntry[]} An array of formatted transcript entries.
     */
     getTranscript(lastSpeakerRequired?: string, excludeEphemeral: boolean = false): FormattedTranscriptEntry[] {
        // Handle cases where the transcript itself is null or undefined.
        if (!this.transcript) {
            return [];
        }

        // Step 1: Perform the consolidation of transcript entries.
        // This reduce operation will return an empty array if this.transcript is empty.
        const consolidatedTranscript: FormattedTranscriptEntry[] = this.transcript
        .filter(entry => !excludeEphemeral || !entry.ephemeral)
        //.filter(entry => !entry.isSuperseded)
        .reduce((accumulator: FormattedTranscriptEntry[], currentEntry: TranscriptEntry) => {
            const speaker = currentEntry.speaker;
            const content = currentEntry.content;
            const isCurrentEphemeral = !!currentEntry.ephemeral;

            const lastEntry = accumulator.length > 0 ? accumulator[accumulator.length - 1] : null;

            if (lastEntry && lastEntry.role === speaker) {
                // Same role, try to merge content
                
                if (typeof content === 'string') {
                    // Current content is text.
                    // Check if the last part of the accumulated entry is also text.
                    const lastPartIndex = lastEntry.parts.length - 1;
                    if (lastPartIndex >= 0 && 'text' in lastEntry.parts[lastPartIndex]) {
                         // Merge text with newline
                         lastEntry.parts[lastPartIndex].text += "\n" + content;
                    } else {
                         // Previous part is not text (e.g. function call), so append new text part
                         lastEntry.parts.push({ text: content });
                    }
                } else if (Array.isArray(content)) {
                    // Do NOT map to text here. Pass the objects through.
                    lastEntry.parts.push(...content);
                }

                // If the existing entry is ephemeral, and the current entry is NOT, 
                // the resulting entry must be marked non-ephemeral (i.e., remove the flag).
                if (lastEntry.ephemeral && !isCurrentEphemeral) {
                    delete lastEntry.ephemeral;
                }
            } else {
                // Different role or the accumulator is empty, so add a new entry.
                let parts: any[] = [];
                
                if (typeof content === 'string') {
                    parts = [{ text: content }];
                } else if (Array.isArray(content)) {
                     parts = [...content];
                }

                const newEntry: FormattedTranscriptEntry = {
                    role: speaker,
                    parts: parts
                };
                if (isCurrentEphemeral) {
                    newEntry.ephemeral = true;
                }
                accumulator.push(newEntry);
            }
            return accumulator;
        }, []);

        // If the consolidation results in an empty transcript (e.g., original was empty),
        // no further processing based on lastSpeakerRequired is needed.
        if (consolidatedTranscript.length === 0) {
            return [];
        }

        // Step 2: If lastSpeakerRequired is not provided (or is falsy),
        // return the full consolidated transcript.
        if (!lastSpeakerRequired) {
            return consolidatedTranscript;
        }

        // Step 3: If lastSpeakerRequired is provided, find the last occurrence of this speaker.
        let lastIndexOfRequiredSpeaker = -1;
        for (let i = consolidatedTranscript.length - 1; i >= 0; i--) {
            if (consolidatedTranscript[i].role === lastSpeakerRequired) {
                lastIndexOfRequiredSpeaker = i;
                break; // Found the last instance, no need to search further.
            }
        }

        // Step 4: Handle based on whether the required speaker was found.
        if (lastIndexOfRequiredSpeaker !== -1) {
            // Truncate the array to include entries up to and including the last required speaker.
            return consolidatedTranscript.slice(0, lastIndexOfRequiredSpeaker + 1);
        } else {
            // The required speaker was not found in the consolidated transcript.
            return [];
        }
    }

    /**
     * Clears all entries from the transcript.
     */
    clearTranscript(): void {
        this.transcript = [];
    }

    /**
     * @method replaceLastEntryContent
     * @description Replaces the content of the very last entry in the transcript.
     * If the transcript is empty, this method does nothing.
     * This also updates the 'originalContent' of that entry to the new content.
     *
     * @param {string} newContent - The new value for the 'content' and 'originalContent' properties.
     */
    replaceLastEntryContent(newContent: string): void {
        if (this.transcript.length === 0) {
            console.warn('replaceLastEntryContent called on an empty transcript.');
            return;
        }

        if (typeof newContent !== 'string') {
            console.warn('replaceLastEntryContent called with non-string newContent.');
            return;
        }

        const lastEntry = this.transcript[this.transcript.length - 1];
        lastEntry.content = newContent;
        lastEntry.originalContent = newContent; // Also update originalContent to match
    }

    /**
     * Retrieves the concatenated content of 'User' entries that form a pending prompt
     * at the end of the transcript.
     *
     * The logic is as follows:
     * 1. If the transcript is empty or the last entry is from 'Model',
     * it means there's no pending 'User' prompt, so it returns `null`.
     * 2. Otherwise (if the last entry is from 'User'), it iterates backward from the end
     * of the transcript, collecting the 'content' of all contiguous 'User' entries.
     * 3. These collected 'content' strings are then concatenated (with spaces) in their
     * original order and returned.
     *
     * This method helps identify user inputs that are awaiting a response from the model.
     *
     * @returns {string | null} The concatenated string of pending 'User' messages,
     * or `null` if no such prompt is found or if the Model spoke last.
     */
    getPendingPrompt(): string | null {
        if (!this.transcript || this.transcript.length === 0) {
            return null;
        }

        const lastEntry = this.transcript[this.transcript.length - 1];

        // If the last entry in the transcript was from the 'Model',
        // then there is no pending prompt from the 'User'.
        if (lastEntry.speaker === "model") {
            return null;
        }

        // If we're here, the last entry was not 'Model'.
        // We now collect all contiguous 'User' entries from the end.
        const pendingUserContents: string[] = [];
        for (let i = this.transcript.length - 1; i >= 0; i--) {
            const entry = this.transcript[i];
            if (entry.speaker === "user") {
                // Add to the beginning of the array to maintain the original order of messages
                if (typeof entry.content === 'string') {
                     pendingUserContents.unshift(entry.content);
                }
            } else {
                // We encountered a non-User entry (e.g., 'Model'),
                // so the sequence of pending User messages has ended.
                break;
            }
        }

        // If, after checking, no User content was found (e.g., transcript ended with a non-Model, non-User entry,
        // or User entries had empty content - though this method assumes content is present), return null.
        if (pendingUserContents.length === 0) {
            return null;
        }

        // Join the collected User contents with a space.
        return pendingUserContents.join("\n");
    }

    getFullTranscriptAsString() {
        if (!this.transcript || this.transcript.length == 0)
            return 'NO TRANSCRIPT';      

        let chatHistoryArray = [...this.transcript];

        // Map over the array to format each message object into a string
        const formattedMessages = chatHistoryArray.map((message, _index) => {
            const role = message.speaker; // 'user' or 'model'
            let text = message.content;
            
            if (Array.isArray(text)) {
                text = JSON.stringify(text);
            }
            return `${role}: ${text}`;
        });
      
        const historyString = formattedMessages.join("\n");
        return historyString;        
    }

    getTranscriptAsString(trimPreamble: boolean, expertNames: string[]): string {
        if (!this.transcript || this.transcript.length == 0)
            return '';

        let chatHistoryArray = [...this.transcript];

        // Only slice if we are actually trimming the preamble
        if (trimPreamble && chatHistoryArray.length > 0)
            chatHistoryArray = chatHistoryArray.slice(1);
      
        // Map over the array to format each message object into a string
        const formattedMessages = chatHistoryArray.map((message, index) => {
            let text = message.content;
            
            // Check if content is an array (which holds the structured parts)
            if (Array.isArray(text)) {
                // Map the parts to a string, handling images specifically
                text = text.map(part => {
                    if (part.text) {
                        return part.text;
                    } else if (part.inlineData) {
                        // REPLACEMENT: Return a placeholder instead of the binary data
                        return `[Image Attachment: ${part.inlineData.mimeType}]`; 
                    } 
                    return '';
                }).join('\n');
            }
      
            // Capitalize role for readability
            let offset = 0;
            let formattedRole;
            
            if (!trimPreamble && index == 0) {
                formattedRole = "User";
                offset = 1;
            } else {
                 // Existing round-robin logic for expert names
                 formattedRole = expertNames[(index+offset) % expertNames.length];
            }
            
            return `${formattedRole}: ${text}`;
        });
      
        const historyString = formattedMessages.join("\n");
        return historyString;
    }

  async cleanLLMResponse(response: string): Promise<string> {
    const stopStringsArray = (await this.config.context.getAssetString('response-stop-strings'))
        .split('\n')
        .filter(s => s.trim() !== '');
    const allToolInvocationStrings = [...this.config.context.getToolNames(), `STARTWORKPHASE`, `RETURN`, 'TOOL_CALL:FINISH'];

    const toolPrefix = await this.config.context.getAssetString('tool-prefix');
    const lines = response.split('\n');
    const cleanedLines: string[] = [];
    let toolInvocationCount = 0;

    for (const line of lines) {
      // Rule 1: Truncate if a stop string is found on a line by itself.
      if (stopStringsArray.includes(line.trim())) {
        break; 
      }

      // Rule 2: Truncate before the second tool invocation.
      const isToolInvocation = allToolInvocationStrings.some((toolString: string) => line.startsWith(`${toolPrefix}${toolString}`));
      if (isToolInvocation) {
        toolInvocationCount++;
        if (toolInvocationCount >= 2)
            break;
      }

      cleanedLines.push(line);
    }

    return cleanedLines.join('\n').trimEnd();
  }
}