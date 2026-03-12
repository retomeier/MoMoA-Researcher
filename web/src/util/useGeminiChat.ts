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

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { usePrefsContext } from './PrefsProvider';
import { TranscriptManager } from '../../../src/services/transcriptManager';
import { ClientInfrastructureContext } from './clientInfrastructureContext';
import {
    USER_ROLE,
    MODEL_ROLE,
    FormattedTranscriptEntry,
    FunctionCall,
    ToolResult,
    READ_FILES_TOOL_NAME,
    MODIFY_SPEC_TOOL_NAME,
    CLIENT_CHAT_PROMPT,
    ModifySpecResult
} from '../../../src/momoa_core/types';
import { db } from '../firebase';
import { PROJECT_ROOT_PATH } from '../../../src/shared/model';
import { ref, push, onChildAdded, remove, onValue, DataSnapshot, set } from 'firebase/database';
import { GenerateContentResponse } from '@google/genai';
import { execute_modify_spec_tool, execute_read_file_tool } from './clientSideChatTools';

export const sendGeminiOneShot = async (
    prompt: string,
    _apiKey: string,
    modelName?: string
): Promise<string | undefined> => {
    const response = await fetch("/s/llm/oneshot", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            options: {
                model: modelName,
                temperature: 0.7,
            },
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `LLM one-shot request failed with ${response.status}`);
    }

    const data = await response.json() as GenerateContentResponse;
    return data.text;
}

export const useGeminiChat = (projectId: string | undefined, chatContext: string) => {
    const specEntryDocumentId = 'local-spec';
    const { prefs, runtimeConfig } = usePrefsContext();

    const syncedKeysRef = useRef<Set<string>>(new Set());

    const chatRef = useMemo(() => {
        if (!projectId) return null;
        const path = `${PROJECT_ROOT_PATH}/${projectId}/chat`;
        return ref(db, path);
    }, [projectId]);

    useEffect(() => {
        syncedKeysRef.current.clear();
    }, [projectId]);

    const infrastructureContext = useMemo(() => new ClientInfrastructureContext(), []);

    const transcriptManager = useMemo(() => {
        const tm = new TranscriptManager({ context: infrastructureContext });
        tm.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, {
            ephemeral: true,
            documentId: 'local-init',
            replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
        });

        const specEntry = `${chatContext}`;
        tm.addEntry(USER_ROLE, specEntry, {
            ephemeral: true,
            documentId: specEntryDocumentId,
            replacementIfSuperseded: 'Initial project specification (Superseded)'
        });

        return tm;
    }, [infrastructureContext, projectId]);

    const [transcript, setTranscript] = useState<FormattedTranscriptEntry[]>(
        transcriptManager.getTranscript(undefined, true)
    );

    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activityLog, setActivityLog] = useState<string[]>([]);

    const updateTranscriptState = useCallback(() => {
        setTranscript(transcriptManager.getTranscript(undefined, true));
    }, [transcriptManager]);

    const logActivity = useCallback((message: string) => {
        setActivityLog((prev) => {
            if (prev[prev.length - 1] === message) return prev;
            return [...prev, message];
        });
    }, []);

    const projectContextRef = useRef(chatContext);
    useEffect(() => {
        projectContextRef.current = chatContext;
    }, [chatContext]);

    useEffect(() => {
        if (!chatRef) return;

        const onChildAddedListener = onChildAdded(chatRef, (snapshot: DataSnapshot) => {
            const key = snapshot.key;
            const entry = snapshot.val();

            if (key && entry && entry.role && entry.content) {
                if (syncedKeysRef.current.has(key)) return;

                transcriptManager.addEntry(entry.role, entry.content, { documentId: key });
                syncedKeysRef.current.add(key);
                updateTranscriptState();
            }
        });

        const onValueListener = onValue(chatRef, (snapshot: DataSnapshot) => {
            if (snapshot.val() === null) {
                if (transcriptManager.getTranscript().length > 0) {
                    transcriptManager.clearTranscript();

                    transcriptManager.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, {
                        ephemeral: true,
                        documentId: 'local-init',
                        replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
                    });

                    const specEntry = `${projectContextRef.current}`;
                    transcriptManager.addEntry(USER_ROLE, specEntry, {
                        ephemeral: true,
                        documentId: specEntryDocumentId,
                        replacementIfSuperseded: 'Initial project specification (Superseded)'
                    });

                    syncedKeysRef.current.clear();
                    updateTranscriptState();
                }
            }
        });

        return () => {
            onChildAddedListener();
            onValueListener();
        };
    }, [chatRef, transcriptManager, updateTranscriptState]);

    useEffect(() => {
        const specContent = `${chatContext}`;
        transcriptManager.replaceEntry(specEntryDocumentId, specContent);
        updateTranscriptState();
    }, [chatContext, transcriptManager, updateTranscriptState]);

    const sendMessage = useCallback(async (
        userMessage: string,
        image?: string,
        imageMimeType?: string,
        files?: { path: string; content: string }[]
    ) => {
        if (isSending) return;

        let content: string | any[] = userMessage;

        if ((image && imageMimeType) || (files && files.length > 0)) {
            const parts: any[] = [];

            if (image && imageMimeType) {
                parts.push({
                    inlineData: {
                        mimeType: imageMimeType,
                        data: image
                    }
                });
            }

            if (files && files.length > 0) {
                files.forEach(file => {
                    parts.push({
                        text: `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``
                    });
                });
            }

            parts.push({ text: userMessage });
            content = parts;
        }

        if (chatRef) {
            const messageData = { role: USER_ROLE, content };
            const newRef = push(chatRef);
            const firebaseKey = newRef.key!;
            syncedKeysRef.current.add(firebaseKey);
            transcriptManager.addEntry(USER_ROLE, content, { documentId: firebaseKey });
            updateTranscriptState();
            await set(newRef, messageData);
        } else {
            transcriptManager.addEntry(USER_ROLE, content);
            updateTranscriptState();
        }

        setError(null);
        setIsSending(true);
        setActivityLog([]);
        logActivity('Preparing your message');

        try {
            let modelResponseText;
            let response: GenerateContentResponse | undefined;
            let isToolCall = true;
            let loopCount = 0;
            const MAX_REACT_STEPS = 10;

            while (isToolCall && loopCount < MAX_REACT_STEPS) {
                loopCount++;
                logActivity(loopCount === 1 ? 'Sending your question to the model' : 'Continuing the answer with the latest tool results');

                const llmResponse = await fetch("/s/llm/chat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        transcript: transcriptManager.getTranscript(),
                        options: {
                            model: runtimeConfig?.defaultModel,
                            temperature: 0.7,
                        },
                    }),
                });

                if (!llmResponse.ok) {
                    const errorData = await llmResponse.json().catch(() => null);
                    throw new Error(errorData?.error || `LLM chat request failed with ${llmResponse.status}`);
                }

                response = await llmResponse.json() as GenerateContentResponse;
                logActivity('Model responded');
                const candidate = response.candidates?.[0];
                const parts = candidate?.content?.parts || [];

                const functionCalls = parts
                    .filter((part) => part.functionCall)
                    .map((part) => ({
                        name: part.functionCall!.name,
                        args: part.functionCall!.args,
                    })) as unknown as FunctionCall[];

                if (functionCalls.length > 0) {
                    const toolCall = functionCalls[0];
                    const toolLabel =
                        toolCall.name === READ_FILES_TOOL_NAME
                            ? 'Reading project files'
                            : toolCall.name === MODIFY_SPEC_TOOL_NAME
                              ? 'Updating the project specification'
                              : `Running tool: ${toolCall.name}`;

                    logActivity(toolLabel);

                    if (chatRef) {
                        const modelCallRef = push(chatRef);
                        const firebaseKey = modelCallRef.key!;
                        syncedKeysRef.current.add(firebaseKey);
                        transcriptManager.addEntry(MODEL_ROLE, parts, { documentId: firebaseKey });
                        updateTranscriptState();
                        await set(modelCallRef, { role: MODEL_ROLE, content: parts });
                    } else {
                        transcriptManager.addEntry(MODEL_ROLE, parts);
                        updateTranscriptState();
                    }

                    let toolResult: ToolResult;

                    if (toolCall.name === READ_FILES_TOOL_NAME) {
                        const fileNames = toolCall.args.fileNames as string[];
                        toolResult = await execute_read_file_tool(projectId, fileNames, prefs.githubToken);
                    } else if (toolCall.name === MODIFY_SPEC_TOOL_NAME) {
                        const { full_content, reason } = toolCall.args;
                        const modifySpecResult: ModifySpecResult = { full_content: full_content as string, reason: reason as string };
                        toolResult = await execute_modify_spec_tool(projectId, modifySpecResult);
                        isToolCall = false;
                        modelResponseText = modifySpecResult.reason;
                    } else {
                        toolResult = {
                            role: USER_ROLE,
                            name: toolCall.name,
                            response: `Error: Unknown tool '${toolCall.name}' requested.`,
                        };
                    }

                    const responsePart = {
                        functionResponse: {
                            name: toolCall.name,
                            response: {
                                name: toolCall.name,
                                content: toolResult.response
                            }
                        }
                    };

                    if (chatRef) {
                        const funcResultRef = push(chatRef);
                        const firebaseKey = funcResultRef.key!;
                        syncedKeysRef.current.add(firebaseKey);
                        transcriptManager.addEntry('function', [responsePart], { documentId: firebaseKey });
                        updateTranscriptState();
                        await set(funcResultRef, { role: 'function', content: [responsePart] });
                    } else {
                        transcriptManager.addEntry('function', [responsePart]);
                        updateTranscriptState();
                    }

                    logActivity('Tool finished, sending the result back to the model');
                } else {
                    isToolCall = false;
                    modelResponseText = response.text;
                }
            }

            if (!modelResponseText && response) {
                modelResponseText = response.text;
            }

            if (!modelResponseText) {
                if (isToolCall) {
                    modelResponseText = "Task completed (Tool execution finished).";
                } else {
                    throw new Error('Received an empty final response from the configured LLM.');
                }
            }

            if (chatRef && modelResponseText) {
                logActivity('Writing the answer to chat');
                const messageData = { role: MODEL_ROLE, content: modelResponseText };
                const newRef = push(chatRef);
                const firebaseKey = newRef.key!;
                syncedKeysRef.current.add(firebaseKey);
                transcriptManager.addEntry(MODEL_ROLE, modelResponseText, { documentId: firebaseKey });
                updateTranscriptState();
                await set(newRef, messageData);
            } else if (!chatRef && modelResponseText) {
                logActivity('Answer ready');
                transcriptManager.addEntry(MODEL_ROLE, modelResponseText);
                updateTranscriptState();
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred during the API call.';
            console.error('LLM Chat Error:', e);
            setError(errorMessage);
            logActivity('The request ended with an error');
            transcriptManager.addEntry(MODEL_ROLE, `Error: ${errorMessage}`);
            updateTranscriptState();
        } finally {
            setIsSending(false);
        }
    }, [isSending, transcriptManager, updateTranscriptState, chatRef, prefs.githubToken, projectId, runtimeConfig?.defaultModel, logActivity]);

    const deleteTranscript = useCallback(async () => {
        transcriptManager.clearTranscript();
        transcriptManager.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, {
            ephemeral: true,
            documentId: 'local-init',
            replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
        });

        const specEntry = `${chatContext}`;
        transcriptManager.addEntry(USER_ROLE, specEntry, {
            ephemeral: true,
            documentId: specEntryDocumentId,
            replacementIfSuperseded: 'Initial project specification (Superseded)'
        });

        updateTranscriptState();

        if (chatRef) {
            try {
                await remove(chatRef);
                syncedKeysRef.current.clear();
            } catch (e) {
                console.error('Failed to delete transcript from Firebase:', e);
            }
        }
    }, [chatRef, transcriptManager, updateTranscriptState, chatContext]);

    return {
        sendMessage,
        isSending,
        error,
        transcript,
        deleteTranscript,
        activityLog,
    };
};
