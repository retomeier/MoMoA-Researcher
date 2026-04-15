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

import { FuzzyReplaceResult } from "../momoa_core/types.js";

interface Match {
    startIndex: number;
    endIndex: number;
    matchedText: string;
}

function escapeRegExp(str: string): string {
    // $& means the whole matched string
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getLineStartIndices(text: string): number[] {
    const indices: number[] = [0];
    const newlineRegex = /\r?\n/g;
    let match: RegExpExecArray | null;

    while ((match = newlineRegex.exec(text)) !== null) {
        indices.push(match.index + match[0].length);
    }
    return indices;
}

function findLineNumber(charIndex: number, lineStartIndices: number[]): number {
    // Search from the end for efficiency
    for (let i = lineStartIndices.length - 1; i >= 0; i--) {
        if (charIndex >= lineStartIndices[i]) {
            return i + 1;
        }
    }
    return 1;
}

function generateNoMatchError(originalString: string, textToReplace: string): string {
    // Attempt to find a match for an initial segment of the text to provide a better error.
    const ttrLines = textToReplace.split(/\r?\n/);
    let ttrSearchPrefixContent = ttrLines[0];
    if (ttrLines.length > 1 && ttrSearchPrefixContent.length < 30) {
        ttrSearchPrefixContent += `\n${ttrLines[1]}`;
    }
    ttrSearchPrefixContent = ttrSearchPrefixContent.substring(0, 120);

    const searchPrefixParts = ttrSearchPrefixContent.split(/\s+/).filter(p => p.length > 0);

    if (searchPrefixParts.length > 0) {
        try {
            const prefixPatternRegex = new RegExp(searchPrefixParts.map(escapeRegExp).join('\\s+'), 'i');
            const prefixMatchResult = prefixPatternRegex.exec(originalString);

            if (prefixMatchResult) {
                const matchedPrefixInOS = prefixMatchResult[0];
                let displaySearchedPrefix = searchPrefixParts.join(' ');
                if (displaySearchedPrefix.length > 40) displaySearchedPrefix = `${displaySearchedPrefix.substring(0, 37)}...`;

                let displayMatchedPrefixInOS = matchedPrefixInOS.replace(/\s+/g, ' ');
                if (displayMatchedPrefixInOS.length > 60) displayMatchedPrefixInOS = `${displayMatchedPrefixInOS.substring(0, 57)}...`;

                return `The text to replace was not found. A segment starting with content similar to '${displaySearchedPrefix}' (found in file as '${displayMatchedPrefixInOS}') was identified, but the full block did not match. Please check for discrepancies after this initial segment.`;
            }
        } catch (e) {
        }
    }

    // Generic fallback error.
    let ttrExcerptForDisplay = textToReplace.replace(/\s+/g, ' ').trim().substring(0, 70);
    if (textToReplace.length > 70) ttrExcerptForDisplay += "...";
    return `The text to replace (starting with '${ttrExcerptForDisplay}') was not found. Key components seem to be missing or significantly different in the file.`;
}

function performSingleFuzzyReplace(originalString: string, match: Match, textToReplace: string, replacementText: string): string {
    const coreMatchStartInOS = match.startIndex;
    const coreContentMatchedInOS = match.matchedText;
    const coreContentEndInOS = coreMatchStartInOS + coreContentMatchedInOS.length;

    // --- Inlined Helper Logic for Trailing Whitespace Analysis ---
    const trailingWhitespaceMatch = textToReplace.match(/(\s*)$/);
    const ttrTrailingWhitespaceText = trailingWhitespaceMatch ? (trailingWhitespaceMatch[1] || "") : "";
    const newlineMatches = ttrTrailingWhitespaceText.match(/\r?\n/g);
    const numExpectedNewlinesInTTR = newlineMatches ? newlineMatches.length : 0;
    const ttrTrailIsPurelyNewlines = /^[\r\n]*$/.test(ttrTrailingWhitespaceText);
    // --- End Inlined Logic ---

    // The regex only matches content, not surrounding whitespace.
    // We must now match the TRAILING whitespace of `textToReplace` in the `originalString`
    // to determine the precise end of the segment to be replaced.
    let suffixStartIndex = coreContentEndInOS;
    let newlinesConsumedFromOS = 0;
    let tempOsIndex = coreContentEndInOS;

    while (tempOsIndex < originalString.length) {
        if (newlinesConsumedFromOS >= numExpectedNewlinesInTTR && ttrTrailIsPurelyNewlines) break;

        const char = originalString[tempOsIndex];
        if (char === '\n' || (char === '\r' && originalString[tempOsIndex + 1] === '\n')) {
            tempOsIndex += (char === '\r' ? 2 : 1);
            newlinesConsumedFromOS++;
        } else if (char === ' ' || char === '\t') {
            if (ttrTrailIsPurelyNewlines) break;
            tempOsIndex++;
        } else {
            break;
        }
    }
    suffixStartIndex = tempOsIndex;

    const prefix = originalString.substring(0, coreMatchStartInOS);
    const suffix = originalString.substring(suffixStartIndex);
    const modifiedString = prefix + replacementText + suffix;

    return modifiedString;
}

function generateDisambiguationSnippets(originalString: string, matches: Match[]): string[] {
    const disambiguationSnippets: string[] = [];
    const originalLinesArray = originalString.split(/\r?\n/);
    const lineStartIndices = getLineStartIndices(originalString);

    for (const match of matches) {
        const matchStartLineNum = findLineNumber(match.startIndex, lineStartIndices);
        const matchEndLineNum = findLineNumber(Math.max(0, match.endIndex - 1), lineStartIndices);

        // Find the first non-empty preceding line for context
        let contextStartLineNum = matchStartLineNum;
        for (let i = matchStartLineNum - 2; i >= 0; i--) {
            if (originalLinesArray[i].trim() !== '') {
                contextStartLineNum = i + 1;
                break;
            }
        }
        contextStartLineNum = Math.max(1, contextStartLineNum);

        // Find the first non-empty succeeding line for context
        let contextEndLineNum = matchEndLineNum;
        for (let i = matchEndLineNum; i < originalLinesArray.length; i++) {
            if (originalLinesArray[i].trim() !== '') {
                contextEndLineNum = i + 1;
                break;
            }
        }
        contextEndLineNum = Math.min(originalLinesArray.length, contextEndLineNum);

        const snippetStartCharIndex = lineStartIndices[contextStartLineNum - 1];
        const snippetEndCharIndex = (contextEndLineNum < lineStartIndices.length)
            ? lineStartIndices[contextEndLineNum]
            : originalString.length;

        let snippet = originalString.slice(snippetStartCharIndex, snippetEndCharIndex);

        // Trim trailing newline that comes from slicing up to the start of the next line
        if (snippet.endsWith('\r\n')) {
            snippet = snippet.slice(0, -2);
        } else if (snippet.endsWith('\n')) {
            snippet = snippet.slice(0, -1);
        }
        disambiguationSnippets.push(snippet);
    }
    return disambiguationSnippets;
}

/**
 * Replaces a substring within an original string, ignoring whitespace differences
 * (including line breaks) and case differences. It preserves original indentation on replacement.
 *
 * @param originalString The string to perform the replacement in.
 * @param textToReplace The substring to find (potentially with different whitespace/case).
 * @param replacementText The text to insert.
 */
export function fuzzyReplace(
    originalString: string,
    textToReplace: string,
    replacementText: string
): FuzzyReplaceResult {
    const parts = textToReplace.split(/\s+/).filter(part => part.length > 0);

    if (parts.length === 0) {
        return {error: `The specified text to replace is empty or contains only whitespace. No replacement possible.`};
    }

    // Fast path: If there's exactly one literal (but case-insensitive) match, perform a simple replacement.
    if (textToReplace) {
        const escapedSubStringForCount = escapeRegExp(textToReplace);
        // A positive lookahead `(?=...)` allows for overlapping matches because it doesn't consume characters.
        const countRegex = new RegExp(`(?=(${escapedSubStringForCount}))`, 'gi');
        const occurrences = Array.from(originalString.matchAll(countRegex)).length;

        if (occurrences === 1) {
            const replaceRegex = new RegExp(escapedSubStringForCount, 'i');
            const simpleReplaceString = originalString.replace(replaceRegex, replacementText);
            return {modifiedString: simpleReplaceString };
        }
    }

    // Fuzzy match path:
    const pattern = parts.map(escapeRegExp).join('\\s+');
    const searchRegex = new RegExp(pattern, 'gi');
    const matches: Match[] = [];
    let matchResult: RegExpExecArray | null;

    while ((matchResult = searchRegex.exec(originalString)) !== null) {
        matches.push({
            startIndex: matchResult.index,
            endIndex: matchResult.index + matchResult[0].length,
            matchedText: matchResult[0]
        });
        // Prevent infinite loops on zero-length matches
        if (matchResult[0].length === 0) {
            searchRegex.lastIndex++;
        }
    }

    // Dispatch to the appropriate handler based on the number of matches.
    if (matches.length === 0) {
        return { error: generateNoMatchError(originalString, textToReplace) };
    } else if (matches.length === 1) {
        return { modifiedString: performSingleFuzzyReplace(originalString, matches[0], textToReplace, replacementText) };
    } else {
        return { multipleMatches : generateDisambiguationSnippets(originalString, matches) };
    }
}
