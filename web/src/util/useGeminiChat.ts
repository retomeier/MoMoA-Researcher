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
import { GeminiClient } from '../../../src/services/geminiClient';
import { ApiPolicyManager } from '../../../src/services/apiPolicyManager';
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
import { DEFAULT_GEMINI_PRO_MODEL } from '../../../src/config/models';

// Define the model to use, as per task instructions.
const DEFAULT_MODEL = DEFAULT_GEMINI_PRO_MODEL;

export const sendGeminiOneShot = async (prompt: string, apiKey: string, modelName: string = DEFAULT_MODEL): Promise<string | undefined> => {
    if (!apiKey) {
        const errorMessage = 'Gemini API key is missing in preferences.';
        console.error(errorMessage);
        throw new Error('Gemini API key is missing in preferences.');
    }

    const infrastructureContext = new ClientInfrastructureContext();
    const apiPolicyManager = new ApiPolicyManager();
    const geminiClient = new GeminiClient({ apiKey, context: infrastructureContext }, apiPolicyManager);
     
    const response = await geminiClient.sendOneShotMessage(
        prompt,
        {
            model: modelName,
            temperature: 0.7
        }
    );
    return response.text;
}

/**
 * @hook useGeminiChat
 * @description Provides functionality for initiating a Gemini chat session based on a transcript,
 * running entirely client-side using shared services.
 */
export const useGeminiChat = (projectId: string | undefined, chatContext: string) => {
    const specEntryDocumentId = 'local-spec';
    const { prefs } = usePrefsContext();

    // Ref to track Firebase keys already added to the local transcript.
    // This acts as a primary optimization to avoid re-processing known keys.
    const syncedKeysRef = useRef<Set<string>>(new Set());

    // Memoized Firebase reference
    const chatRef = useMemo(() => {
        if (!projectId) return null;
        const path = `${PROJECT_ROOT_PATH}/${projectId}/chat`;
        return ref(db, path);
    }, [projectId]);

    // 1. Reset synced keys whenever projectId changes
    useEffect(() => {
        syncedKeysRef.current.clear();
    }, [projectId]);

    // 2. State Management
    const infrastructureContext = useMemo(() => new ClientInfrastructureContext(), []);
    const apiPolicyManager = useMemo(() => new ApiPolicyManager(), []);
    
    // 3. TranscriptManager Initialization
    const transcriptManager = useMemo(() => {
        const tm = new TranscriptManager({ context: infrastructureContext });

        // Initial Prompt Injection
        tm.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, { 
            ephemeral: true, 
            documentId: 'local-init',
            replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
        });

        // Specification Injection
        const spec_entry = `${chatContext}`;
        tm.addEntry(USER_ROLE, spec_entry, { 
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

    // Helper function to update React state after TM mutation
    const updateTranscriptState = useCallback(() => {
        setTranscript(transcriptManager.getTranscript(undefined, true));
    }, [transcriptManager]);

    const projectContextRef = useRef(chatContext);
    useEffect(() => {
        projectContextRef.current = chatContext;
    }, [chatContext]);

    // 4. Synchronization Logic
    useEffect(() => {
        if (!chatRef) return;

        const onChildAddedListener = onChildAdded(chatRef, (snapshot: DataSnapshot) => {
            const key = snapshot.key;
            const entry = snapshot.val();

            if (key && entry && entry.role && entry.content) {
                // Optimization: Skip if we know we synced this key explicitly
                if (syncedKeysRef.current.has(key)) return;

                // Even if not in syncedKeysRef (e.g. on page refresh or effect reset),
                // the TranscriptManager's new Idempotency check (in addEntry) will
                // prevent duplicates if documentId and content match.
                transcriptManager.addEntry(entry.role, entry.content, { documentId: key });
                
                syncedKeysRef.current.add(key);
                updateTranscriptState();
            }
        });

        // Listen for the entire chat node being removed (deleted by another client)
        const onValueListener = onValue(chatRef, (snapshot: DataSnapshot) => {
            if (snapshot.val() === null) {
                // The entire chat node was deleted remotely. Clear local state.
                if (transcriptManager.getTranscript().length > 0) {
                    transcriptManager.clearTranscript();
                    
                    // Re-inject Preamble
                    transcriptManager.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, { 
                        ephemeral: true, 
                        documentId: 'local-init',
                        replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
                    });

                    // Re-inject Spec
                    // [FIX] Use ref here to get latest spec without dependency
                    const spec_entry = `${projectContextRef.current}`;

                    transcriptManager.addEntry(USER_ROLE, spec_entry, { 
                        ephemeral: true, 
                        documentId: specEntryDocumentId,
                        replacementIfSuperseded: 'Initial project specification (Superseded)'
                    });

                    syncedKeysRef.current.clear();
                    updateTranscriptState();
                }
            }
        });

        // Cleanup function
        return () => {
            onChildAddedListener(); 
            onValueListener(); 
        };
    }, [chatRef, transcriptManager, updateTranscriptState]); // [FIX] Removed projectSpecification from dependency array

    // 5. Reactive Specification Update
    // Keeps the second entry (local-spec) updated if the spec text area changes
    useEffect(() => {
        const specContent = `${chatContext}`;
        transcriptManager.replaceEntry(specEntryDocumentId, specContent);
        
        // Update UI state to reflect the change
        updateTranscriptState();
    }, [chatContext, transcriptManager, updateTranscriptState]);

    /**
     * Sends a user message, updates the transcript, and calls the Gemini API.
     * @param userMessage The message text from the user.
     * @param image Optional Base64 encoded image data.
     * @param imageMimeType Optional MIME type of the attached image.
     */
    const sendMessage = useCallback(async (
        userMessage: string, 
        image?: string, 
        imageMimeType?: string,
        files?: { path: string; content: string }[]
    ) => {
        if (isSending) return;

        // Prepare content: either simple string or array of parts (if image or files are present)
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

        // [OPTIMISTIC UPDATE] 1. User Message
        if (chatRef) {
            const messageData = { role: USER_ROLE, content: content };
            const newRef = push(chatRef);
            const firebaseKey = newRef.key!;
            
            // A. Track Key Immediately
            syncedKeysRef.current.add(firebaseKey);
            
            // B. Update UI Immediately - Assign Firebase Key as documentId
            transcriptManager.addEntry(USER_ROLE, content, { documentId: firebaseKey });
            updateTranscriptState();
            
            // C. Send to DB
            await set(newRef, messageData);
        } else {
             // Fallback for offline/no-project
             transcriptManager.addEntry(USER_ROLE, content);
             updateTranscriptState();
        }

        setError(null);
        setIsSending(true);

        try {
            const apiKey = prefs.geminiApiKey;

            if (!apiKey) {
                const errorMessage = 'Gemini API key is missing in preferences.';
                console.error(errorMessage);
                setError(errorMessage);
                return;
            }

            const geminiClient = new GeminiClient({ apiKey, context: infrastructureContext }, apiPolicyManager);
            
            let modelResponseText;
            let response: GenerateContentResponse | undefined;
            let isToolCall = true;
            let loopCount = 0;
            const MAX_REACT_STEPS = 10;

            while (isToolCall && loopCount < MAX_REACT_STEPS) {
                loopCount++;
                
                // 1. Send Request to LLM
                response = await geminiClient.sendTranscriptMessage(
                    transcriptManager,
                    {
                        model: DEFAULT_MODEL,
                        temperature: 0.7,
                        // tools: toolDeclarations,
                    }
                );

                const candidate = response.candidates?.[0];
                const parts = candidate?.content?.parts || [];
                
                const functionCalls = parts
                    .filter((part) => part.functionCall)
                    .map((part) => ({
                        name: part.functionCall!.name,
                        args: part.functionCall!.args,
                    })) as unknown as FunctionCall[];

                // 2. Handle Tool Calls
                if (functionCalls.length > 0) {
                    
                    // [OPTIMISTIC UPDATE] 2. Model Tool Request (Thinking)
                    if (chatRef) {
                        const modelCallRef = push(chatRef);
                        const firebaseKey = modelCallRef.key!;
                        
                        syncedKeysRef.current.add(firebaseKey);
                        
                        //transcriptManager.addEntry(MODEL_ROLE, parts, { documentId: firebaseKey });
                        updateTranscriptState();

                        await set(modelCallRef, { role: MODEL_ROLE, content: parts });
                    } else {
                        transcriptManager.addEntry(MODEL_ROLE, parts);
                        updateTranscriptState();
                    }

                    // Execute Tool
                    const toolCall = functionCalls[0];
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

                    // [OPTIMISTIC UPDATE] 3. Tool Result
                    const responsePart = {
                        functionResponse: {
                            name: toolCall.name,
                            response: { 
                                name: toolCall.name,
                                content: toolResult.response 
                            }
                        }
                    };

                    // Persist to Firebase with 'function' role
                    if (chatRef) {
                        const funcResultRef = push(chatRef);
                        const firebaseKey = funcResultRef.key!;
                        
                        // A. Track
                        syncedKeysRef.current.add(firebaseKey);
                        
                        // B. Update UI - Assign Firebase Key as documentId
                        transcriptManager.addEntry('function', [responsePart], { documentId: firebaseKey });
                        updateTranscriptState(); 

                        // C. Send
                        await set(funcResultRef, { role: 'function', content: [responsePart] });
                    } else {
                        transcriptManager.addEntry('function', [responsePart]);
                        updateTranscriptState();
                    }

                } else {
                    isToolCall = false;
                    // It's a pure text response
                    modelResponseText = response.text;
                }
            }

            // Fallback if text wasn't extracted in loop (e.g. if loop broke early)
            if (!modelResponseText && response) {
                 modelResponseText = response.text;
            }

            if (!modelResponseText) {
                 if (isToolCall) {
                    if (!modelResponseText) modelResponseText = "Task completed (Tool execution finished).";
                 } else {
                    throw new Error('Received an empty final response from Gemini.');
                 }
            }

            // [OPTIMISTIC UPDATE] 4. Final Model Text Response
            if (chatRef && modelResponseText) {
                const messageData = { role: MODEL_ROLE, content: modelResponseText };
                const newRef = push(chatRef);
                const firebaseKey = newRef.key!;
                
                // A. Track
                syncedKeysRef.current.add(firebaseKey);
                
                // B. Update UI - Assign Firebase Key as documentId
                // transcriptManager.addEntry(MODEL_ROLE, modelResponseText, { documentId: firebaseKey });
                updateTranscriptState();

                // C. Send
                await set(newRef, messageData);
            } else if (!chatRef && modelResponseText) {
                transcriptManager.addEntry(MODEL_ROLE, modelResponseText);
                updateTranscriptState();
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred during the API call.';
            console.error('Gemini Chat Error:', e);
            setError(errorMessage);
            
            // Add an error message to the transcript for visibility
            transcriptManager.addEntry(MODEL_ROLE, `Error: ${errorMessage}`);
            updateTranscriptState();

        } finally {
            setIsSending(false);
        }
    }, [prefs.geminiApiKey, isSending, transcriptManager, updateTranscriptState, infrastructureContext, apiPolicyManager, chatRef, prefs.githubToken, projectId]);

    /**
     * Clears the local transcript and removes the persisted chat data from Firebase RTDB.
     */
    const deleteTranscript = useCallback(async () => {
        // Clear local state
        transcriptManager.clearTranscript();
        
        // IMMEDIATE RE-INJECTION OF PREAMBLES
        transcriptManager.addEntry(USER_ROLE, CLIENT_CHAT_PROMPT, { 
            ephemeral: true, 
            documentId: 'local-init',
            replacementIfSuperseded: 'Initial Prompt Content (Superseded)'
        });

        const spec_entry = `${chatContext}`;
        transcriptManager.addEntry(USER_ROLE, spec_entry, { 
            ephemeral: true, 
            documentId: specEntryDocumentId,
            replacementIfSuperseded: 'Initial project specification (Superseded)'
        });

        updateTranscriptState();
        
        // Clear Firebase data
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
    };
};