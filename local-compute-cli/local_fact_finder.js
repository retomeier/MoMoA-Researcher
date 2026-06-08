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

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

const apiKey = process.env.GEMINI_API_KEY;
const folderPath = process.argv[2];
const question = process.argv[3];

if (!apiKey || !folderPath || !question) {
    console.error("Usage: node local_fact_finder.js <folderPath> \"<question>\"");
    process.exit(1);
}

// Ensure we have an absolute path to the designated root directory to validate against
const rootDirPath = path.resolve(folderPath);

const ai = new GoogleGenAI({ apiKey: apiKey });

const tools = [{
    functionDeclarations: [
        {
            name: 'read_directory',
            description: 'List the contents of a local directory to find relevant files and subfolders.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    dirPath: { type: 'STRING', description: 'The relative path to the directory. Use "." for the root directory.' }
                },
                required: ['dirPath']
            }
        },
        {
            name: 'read_file',
            description: 'Read the content of a specific local file. Supports text, images, and PDFs.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filePath: { type: 'STRING', description: 'The relative path to the file.' }
                },
                required: ['filePath']
            }
        }
    ]
}];

// Helper function to validate that requested paths stay within the root directory
function isPathAllowed(requestedPath) {
    const resolvedPath = path.resolve(rootDirPath, requestedPath);
    const relative = path.relative(rootDirPath, resolvedPath);
    // Allowed if it's the root directory itself ('') or it doesn't navigate up ('..') and isn't absolute
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Helper to safely get the absolute target path (kept internal, not shown to LLM)
function getResolvedPath(requestedPath) {
    return path.resolve(rootDirPath, requestedPath);
}

async function runLocalAgent() {
    const chat = ai.chats.create({
        model: 'gemini-flash-latest',
        config: {
            systemInstruction: `You are a local research agent. You must use **only** the content of the files available to you to try and answer the provided question. You must rely ONLY on the content of the files. Do NOT hallucinate or provide likely answers. If the provided files do not provide sufficient information to answer the question return the response "No Relevant Information Available".

**Question:**
${question}.

**Instructions:**
1. Start by reading the root directory using the path: .
2. Read potentially relevant files that you believe may help answer the question using their relative paths.
3. If you cannot find information in the provided files to answer the question, return the response: "No Relevant Information Available"
4. If you are confident you can answer the question based on the available files, respond with a detailed answer that includes references to the file(s) whose content you based your answer on`,
            tools: tools,
            temperature: 0.1
        }
    });

    let responded = false;
    let isDone = false;
    let turns = 0;
    const MAX_TURNS = 20;

    // Start the conversation without revealing the absolute folderPath
    let response = await chat.sendMessage({ message: `Please find the answer to the Question using the files in the current root directory.` });

    while (!isDone) {
        if (turns > MAX_TURNS)
            break;

        turns++;
        
        if (response.functionCalls && response.functionCalls.length > 0) {
            const call = response.functionCalls[0];

            let functionResult = "";
            let multimodalAttachment = null;

            try {
                if (call.name === 'read_directory') {
                    if (!isPathAllowed(call.args.dirPath)) {
                        functionResult = `Error: Access denied. Cannot read directories outside of the allowed root folder.`;
                    } else {
                        const targetDir = getResolvedPath(call.args.dirPath);
                        const items = fs.readdirSync(targetDir, { withFileTypes: true });

                        if (items.length === 0) {
                            functionResult = `The directory is empty. No files or folders found.`;
                        } else {
                            const formattedItems = items.map(item => {
                                const type = item.isDirectory() ? '[DIR]' : '[FILE]';
                                // Provide relative paths back to the LLM to keep things clean
                                const itemRelativePath = path.relative(rootDirPath, path.join(targetDir, item.name));
                                return `${type} ${itemRelativePath}`;
                            });
                            functionResult = `Available Contents:\n${formattedItems.join('\n')}`;
                        }
                    }
                } else if (call.name === 'read_file') {
                    if (!isPathAllowed(call.args.filePath)) {
                        functionResult = `Error: Access denied. Cannot read files outside of the allowed root folder.`;
                    } else {
                        const targetFile = getResolvedPath(call.args.filePath);
                        const mimeType = mime.lookup(targetFile);

                        // Check if it's a PDF or Image
                        if (mimeType === 'application/pdf' || (mimeType && mimeType.startsWith('image/'))) {
                            const base64Data = Buffer.from(fs.readFileSync(targetFile)).toString("base64");
                            
                            // Tell the tool it succeeded using the relative path the LLM provided
                            functionResult = `Successfully loaded ${call.args.filePath}. The binary content has been attached to this message for you to analyze.`;
                            
                            multimodalAttachment = {
                                inlineData: {
                                    data: base64Data,
                                    mimeType: mimeType
                                }
                            };
                        } else {
                            // Standard text reading
                            const content = fs.readFileSync(targetFile, 'utf8');
                            functionResult = content; 
                        }
                    }
                }
            } catch (err) {
                functionResult = `Error executing ${call.name}: ${err.message}`;
            }

            const messageParts = [
                {
                    functionResponse: {
                        name: call.name,
                        response: { result: functionResult }
                    }
                }
            ];

            // If we grabbed an image/PDF, attach it to the message alongside the tool response
            if (multimodalAttachment) {
                messageParts.push(multimodalAttachment);
            }

            // Add the warning as a text part if we're at the limit
            if (turns === MAX_TURNS) {
                messageParts.push({ text: "SYSTEM: You have run out of turns. Your next response must be your final response." });
            }

            response = await chat.sendMessage({ message: messageParts });
        } else {
            // The model provided a text response instead of a tool call
            console.log(response.text);
            responded = true;
            isDone = true;
        }
    }

    if (!responded) {
        console.log("No Response Received");
    }
}

runLocalAgent().catch(err => {
    console.error("[System] Error running local information agent:", err.message);
    process.exit(1);
});