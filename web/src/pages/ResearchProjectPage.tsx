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

import React, { useEffect, useState, useRef, useMemo, Fragment } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ProjectMetadata, SessionMetadata, ProposedTask, PROJECT_METADATA_TEMPLATE } from '../document/model-and-db';
import {
  PROJECT_ROOT_PATH,
  SESSION_ROOT_PATH,
  USERINFO_ROOT_PATH,
  HistoryItem,
  InitialRequestData,
  IncomingAction,
} from "../../../src/shared/model";
import { auth, db } from "../firebase";
import { ref, update, onValue, child, push, set, remove, get, query, orderByChild, equalTo } from "firebase/database";
import { useAuthContext } from "../auth/AuthProvider";
import { usePrefsContext } from "../util/PrefsProvider";
import { sendGeminiOneShot, useGeminiChat } from "../util/useGeminiChat";
import { generateId } from "../document/util";
import { encode as _b64encode, decode as b64decode } from "js-base64";
import { PromptBox, PromptExtras } from "../components/PromptBox";
import { ProjectFiles } from "../components/ProjectFiles";
import { SessionList } from "../components/SessionList";
import { InlineTextEdit } from "../components/InlineTextEdit";
import { Logo } from "../components/Logo";
import { encode as b64encode } from "js-base64";
import { GitHubRepoSelector } from "../components/GitHubRepoSelector";
import { 
  Button, 
  Text, 
  IconButton, 
  Tooltip, 
  Flex, 
  Spinner,
  Card,
  ButtonProps,
  Badge,
  Checkbox
} from "@radix-ui/themes";
import { 
  SendIcon, 
  LightbulbIcon,
  Trash2Icon,
  XIcon,
  Wrench,
  PaperclipIcon,
  InfinityIcon,
  BugIcon,
  AlertCircleIcon,
  MessageCircleQuestionIcon,
  InfoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  MessageCircleReplyIcon,
  GraduationCapIcon,
  FileIcon,
  RefreshCwIcon
} from "lucide-react";
import styles from "./ResearchProjectPage.module.scss";
import { cleanLLMOutput, removeBacktickFences } from '@/util/clientSideChatTools';
import { SessionProvider, useSessionContext } from "@/document/SessionProvider";
import ReactMarkdown from "react-markdown";
import cn from "classnames";
import { Timestamp } from "@/components/Timestamp";
import { PatchViewer } from "../components/PatchViewer";
import { Header } from "../components/Header";
import { DEFAULT_GEMINI_LITE_MODEL, DEFAULT_GEMINI_PRO_MODEL } from '../../../src/config/models';
import { buildProjectContextPrompt } from '@/util/promptEnrichment';

interface ProjectRouteParams extends Record<string, string | undefined> {
  projectId: string;
  sessionId?: string;
}

interface TaskItem {
  id: string;
  title: string;
}

const SPEAKER_LABELS: Record<string, string> = {
  user: 'You',
  model: 'Researcher', 
  function: 'Tool Result'
};

const formatString = (input: string): string => {
  if (!input) return '';
  return input.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const ChatPart: React.FC<{ part: any }> = ({ part }) => {
  const renderedElements: React.ReactNode[] = [];
  if (part.text) {
    const fileAttachmentMatch = part.text.match(/^File:\s+(.*?)\n```\n([\s\S]*)\n```$/);
    if (fileAttachmentMatch) {
      renderedElements.push(
        <Card key="file-attachment" size="1" variant="surface" style={{ marginTop: 4, marginBottom: 4, backgroundColor: 'var(--gray-3)', maxWidth: 'fit-content' }}>
          <Flex align="center" gap="2">
            <PaperclipIcon size={14} style={{ color: 'var(--gray-11)' }} />
            <Text size="1" weight="medium" style={{ color: 'var(--gray-11)' }}>{fileAttachmentMatch[1]}</Text>
          </Flex>
        </Card>
      );
    } else {
      const cleanText = cleanLLMOutput(part.text);
      renderedElements.push(<div key="text" className={styles.markdownContent}>{cleanText}</div>);
    }
  }
  
  if (part.functionCall) {
    const toolName = formatString(part.functionCall.name);
    let label = `${toolName}`;
    renderedElements.push(
      <Card key="functionCall" size="1" variant="surface" style={{ marginTop: 8, marginBottom: 8, backgroundColor: 'rgba(0,0,0,0.02)' }}>
          <Flex align="center" gap="2">
            <Wrench size={14} color="gray" />
            <Text size="1" color="gray" weight="bold">{label}</Text>
          </Flex>
      </Card>
    );
  }

  if (part.functionResponse) {
    renderedElements.push(
        <React.Fragment key="functionResponse">
            <Card size="1" variant="surface" style={{ marginTop: 8 }}>
                <Text size="1" color="gray">Tool Output Received {part.functionResponse.name}</Text>
            </Card>
        </React.Fragment>
    );
  }
  return <>{renderedElements}</>;
};

export const ResearchProjectPage: React.FC = () => {
  const { projectId, sessionId } = useParams<ProjectRouteParams>();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { prefs } = usePrefsContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [sessionMeta, setSessionMeta] = useState<SessionMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [sessionContextText, setSessionContextText] = useState<string>("");
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [isGeneratingProjectDetails, setIsGeneratingProjectDetails] = useState(false);

  // 1. Initialize state DIRECTLY from localStorage (Lazy Initializer)
  const [autoRunNext, setAutoRunNext] = useState(() => {
    if (!projectId) return false;
    const savedVal = localStorage.getItem(`autoRunNext_${projectId}`);
    return savedVal === "true";
  });

  const autoRunNextRef = useRef(autoRunNext);

  // 2. Keep the ref in sync
  useEffect(() => {
    autoRunNextRef.current = autoRunNext;
  }, [autoRunNext]);

  // 3. Keep ONLY the save effect (Remove the separate 'load' effect)
  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(`autoRunNext_${projectId}`, String(autoRunNext));
  }, [autoRunNext, projectId]);

  // Use sessionchat namespace so it doesn't overwrite old project chats
  const chatNamespace = sessionId ? `sessionchat-${sessionId}` : `projectchat-${projectId}`;

  const combinedChatContext = `${sessionContextText}`;
  
  const { sendMessage, isSending, transcript, deleteTranscript } = useGeminiChat(chatNamespace, combinedChatContext);

  // 1. Fetch Project Metadata
  useEffect(() => {
    if (!projectId) return;
    const projectRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`);
    const unsubscribe = onValue(projectRef, (snapshot) => {
      setProject(snapshot.val() as ProjectMetadata | null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [projectId]);

  // Fetch Current Session Metadata (For Title replacement)
  useEffect(() => {
    if (!sessionId) {
      setSessionMeta(null);
      return;
    }
    const sessionRef = ref(db, `${SESSION_ROOT_PATH}/${sessionId}/metadata`);
    const unsubscribe = onValue(sessionRef, (snapshot) => {
      setSessionMeta(snapshot.val());
    });
    return () => unsubscribe();
  }, [sessionId]);

  // 2. Fetch Proposed Tasks from DB
  useEffect(() => {
    if (!projectId) return;
    const tasksRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks`);
    const unsubscribe = onValue(tasksRef, (snapshot) => {
      const data = snapshot.val() as Record<string, ProposedTask> | null;
      setTasks(data ? Object.entries(data).map(([key, val]) => ({ id: key, title: val.title })) : []);
    });
    return () => unsubscribe();
  }, [projectId]);

  // Auto-scroll chat history
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Keep the chat context updated with the live session log
  useEffect(() => {
    if (!sessionId || !projectId || !project) {
      setSessionContextText("");
      return;
    }

    const historyRef = ref(db, `${SESSION_ROOT_PATH}/${sessionId}/history`);
    
    // Use onValue so the chat context updates in real-time as the agent works
    const unsubscribe = onValue(historyRef, async () => {
      
      // 1. Define the conversational role for the chat agent
      const chatObjective = `Here is the context for the Research Project:`;
      
      const chatOutputFormat = `Answer the user's questions accurately and conversationally based strictly on the provided logs and definitions.`;

      try {
        // 2. Fetch the newly enriched, standardized context string
        const liveChatContext = await buildProjectContextPrompt(
          projectId, 
          sessionId, 
          project, 
          chatObjective, 
          chatOutputFormat
        );

        // 3. Update the state passing into useGeminiChat
        setSessionContextText(liveChatContext);
      } catch (error) {
        console.error("Failed to build live chat context:", error);
      }
    });

    return () => unsubscribe();
  }, [sessionId, projectId, project]);

  const updateProjectMetadata = (key: keyof ProjectMetadata, value: string) => {
    if (!projectId) return;
    update(ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`), { [key]: value });
  };

  const updateSessionTitle = (newTitle: string) => {
    if (!sessionId) return;
    update(ref(db, `${SESSION_ROOT_PATH}/${sessionId}/metadata`), { title: newTitle });
  };

  const updateTaskTitle = (id: string, newTitle: string) => {
    if (!projectId) return;
    update(ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks/${id}`), { title: newTitle });
  };

  const deleteTask = (id: string) => {
    if (!projectId) return;
    remove(ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks/${id}`));
  };

  const handleForceRefreshTasks = async () => {
    if (!sessionId || !projectId) {
      alert("Please select a session first to base the new tasks on its log.");
      return;
    }
    
    setIsGeneratingTasks(true); // Set loading state immediately
    try {
        // 1. Clear existing tasks locally and in the DB
        const tasksRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks`);
        await remove(tasksRef);

        // 2. Generate new tasks. 
        // We pass an empty array because the utility inside will fetch the latest history anyway.
        await generateProposedTasks([]); 
    } catch (error) {
      console.error("Failed to refresh tasks:", error);
    } finally {
      setIsGeneratingTasks(false);
    }
  };

  const generateProjectDetails = async (summaryText: string) => {
    if (!prefs.geminiApiKey || !projectId) return;

    try {
      const projectNameDescriptionPrompt = `Based on the following task result summary, generate a short, clever "Research Project Name" (max 7 words) and a 1-sentence "Description". 
              
              Summary: "${summaryText}"
              
              Return JSON format: { "title": "...", "description": "..." }`;

      const projectMetaTitle = await sendGeminiOneShot(projectNameDescriptionPrompt, prefs.geminiApiKey);

      if (projectMetaTitle) {
        const cleanProjectMetaTitle = removeBacktickFences(projectMetaTitle);
        const result = JSON.parse(cleanProjectMetaTitle);
        
        if (result.title && result.description) {
           updateProjectMetadata("title", result.title);
           updateProjectMetadata("description", result.description);
        }
      }
    } catch (e) {
      console.error("Failed to auto-generate project details", e);
    }
  };

  const effectiveStatus = useMemo(() => {
    if (!sessionMeta) return null;
    if (sessionMeta.status === "running" && !sessionMeta.runnerInstanceId) {
      return "failed";
    }
    return sessionMeta.status;
  }, [sessionMeta]);

  const handleRefreshProjectDetails = async () => {
    if (!prefs.geminiApiKey || !projectId || !project) return;
    if (!sessionId) {
      alert("Please select a session first to base the context on.");
      return;
    }

    setIsGeneratingProjectDetails(true);
    try {
      const taskObjective = `You are an expert Research Agent Coordinator. Your goal is to generate a short, clever "Research Project Name" (max 7 words) and a 1-sentence "Description" for the overall project based on its context and history.`;
      const outputFormat = `Return ONLY JSON format: { "title": "...", "description": "..." }`;

      const prompt = await buildProjectContextPrompt(projectId, sessionId, project, taskObjective, outputFormat);

      // 5. Send to LLM and update DB
      const projectMetaTitle = await sendGeminiOneShot(prompt.trim(), prefs.geminiApiKey, DEFAULT_GEMINI_LITE_MODEL);

      if (projectMetaTitle) {
        const cleanProjectMetaTitle = removeBacktickFences(projectMetaTitle);
        const result = JSON.parse(cleanProjectMetaTitle);
        
        if (result.title && result.description) {
           updateProjectMetadata("title", result.title);
           updateProjectMetadata("description", result.description);
        }
      }
    } catch (e) {
      console.error("Failed to generate project details", e);
      alert("Failed to refresh project name.");
    } finally {
      setIsGeneratingProjectDetails(false);
    }
  };

  // Track global running state for this project
  useEffect(() => {
    if (!projectId) return;
    
    const sessionsRef = ref(db, SESSION_ROOT_PATH);
    const projectSessionsQuery = query(sessionsRef, orderByChild("metadata/projectId"), equalTo(projectId));

    const unsubscribe = onValue(projectSessionsQuery, (snapshot) => {
      if (snapshot.exists()) {
        // let running = false;
        snapshot.forEach((childSnap) => {
          const session = childSnap.val();
          if (session.metadata?.status === "running" || session.metadata?.status === "pending") {
            // running = true;
          }
        });
        // setIsAnySessionRunning(running);
      } else {
        // setIsAnySessionRunning(false);
      }
    });

    return () => unsubscribe();
  }, [projectId]);


  // Auto-generate project name and next tasks when a session completes
  useEffect(() => {
    if (!sessionId || !project || !sessionMeta) return;
    
    if (effectiveStatus === "complete") {
      const historyRef = ref(db, `${SESSION_ROOT_PATH}/${sessionId}/history`);
      
      // Make the callback async
      get(historyRef).then(async (snapshot) => {
        if (snapshot.exists()) {
          const historyItems = Object.values(snapshot.val()) as HistoryItem[];
          
          // 1. Check and Generate Project Details
          if (project.title === "New Project" || project.title === PROJECT_METADATA_TEMPLATE?.title) {
            const completeItem = historyItems.find(item => item.status === "COMPLETE_RESULT");
            if (completeItem && completeItem.data?.result) {
              generateProjectDetails(completeItem.data.result);
            }
          }

          // 2. Check and Generate Proposed Tasks
          if (!(sessionMeta as any).nextTasksGenerated) {
            requestSessionFeedback();

            // Mark as generated immediately to avoid concurrent runs on strict mode / re-renders
            await update(ref(db, `${SESSION_ROOT_PATH}/${sessionId}/metadata`), { 
              nextTasksGenerated: true 
            });

            // CLEAR the old tasks immediately
            if (projectId) {
               const tasksRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks`);
               await remove(tasksRef);
            }

            // GENERATE new tasks
            const newTasks = await generateProposedTasks(historyItems);

            // AUTO-RUN the top suggestion if continuous mode is checked
            if (autoRunNextRef.current && newTasks && newTasks.length > 0) {
              console.log(`Auto-running next task: ${newTasks[0]}`);
              setTimeout(() => {
                newSession(newTasks[0], { attachments: [], notWorkingBuild: false });
              }, 2000); // Small delay to let Firebase state sync/animate for the user
            }
          }
        }
      }).catch(err => console.error("Failed to fetch history for post-session generation:", err));
    }
  }, [sessionId, sessionMeta?.status, project?.title, (sessionMeta as any)?.nextTasksGenerated]);

  const newSession = async (
    prompt: string,
    { attachments, notWorkingBuild, image, imageMimeType }: PromptExtras
  ): Promise<boolean> => {
    if (!prompt.trim() || !user || !projectId || !project) return false;
    const newSessionId = generateId();
    
    set(ref(db, `${USERINFO_ROOT_PATH}/${user.uid}/sessions/${newSessionId}`), true);

    const sessionRef = ref(db, `${SESSION_ROOT_PATH}/${newSessionId}`);
    
    update(child(sessionRef, "metadata"), {
      startedAt: Date.now(),
      status: "pending",
      title: "New session",
      projectId: projectId, 
    } satisfies SessionMetadata);
    
    const attachedRepo = attachments.find((a) => a.type === "git-repo");
    const effectiveGithubUrl = attachedRepo?.repoUrl || project.githubUrl || "";
    const promptToSend = project.initialPrompt ? 
    `The overarching Research Project Space is defined as follows:
""""
${project.initialPrompt}
""""

Within that context, our objective for this Research Project is to complete the following specific Research Task:
""""
${prompt.trim()}
""""` 
    : prompt.trim();
    
    const requestData: InitialRequestData = {
      secrets: {
        geminiApiKey: prefs.geminiApiKey || "",
        githubScratchPadRepo: prefs.githubScratchPad || "",
        githubToken: prefs.githubToken || "",
        julesApiKey: prefs.julesApiKey || "",
        stitchApiKey: prefs.stitchApiKey || "",
      },
      githubUrl: effectiveGithubUrl,
      llmName: "gemini-2.5-flash",
      prompt: promptToSend,
      projectSpecification: project.spec || "",
      image: image || "",
      imageMimeType: imageMimeType || "",
      notWorkingBuild: notWorkingBuild,
      weaveId: project.weaveId || '',
      toolExecutionEnvironment: prefs.toolRunEnvironment
    };

    // --- GATHER PAST FILES TO CARRY FORWARD PROGRESS ---
    const accumulatedFiles = new Map<string, string>(); // Track files by name -> base64 content
    
    // Keep these all lowercase for the comparison
    const EXCLUDED_FILES = new Set([
      "project.diff",
      "summary.xml",
      "project_plan.md",
      "validation_report.md"
    ]);

    // Parse newly attached files before pushing history
    const newAttachments = attachments
      .filter((a) => a.type === "files")
      .flatMap((a) => (a.type === "files" ? a.files : []))
      .filter((f) => !EXCLUDED_FILES.has(f.path.toLowerCase())) 
      .map(({ path, textContent }) => ({
        name: path,
        content: b64encode(textContent),
      }));

    const historyItem: HistoryItem = {
      status: "USER_MESSAGE",
      message: prompt.trim(),
      timestamp: Date.now(),
      runnerInstanceId: "local-client",
    };
    // Persist attachments to history
    if (newAttachments.length > 0) {
      historyItem.data = { files: JSON.stringify(newAttachments) };
    }
    push(child(sessionRef, "history"), historyItem);

    push(child(sessionRef, "actionQueue"), {
      status: "INITIAL_REQUEST_PARAMS",
      data: requestData,
    } satisfies IncomingAction);
    
    try {
      // Query all sessions for this project
      const allSessionsRef = ref(db, SESSION_ROOT_PATH);
      const projectSessionsQuery = query(allSessionsRef, orderByChild("metadata/projectId"), equalTo(projectId));
      const snapshot = await get(projectSessionsQuery);
      
      if (snapshot.exists()) {
        const pastSessions: any[] = [];
        snapshot.forEach((childSnap) => {
          pastSessions.push(childSnap.val());
        });
        
        // Sort chronologically by start time
        pastSessions.sort((a, b) => (a.metadata?.startedAt || 0) - (b.metadata?.startedAt || 0));
        
        for (const pastSession of pastSessions) {
          // 1. Fallback: Check actionQueue for backward compatibility with older sessions
          if (pastSession.actionQueue) {
            const actions = Object.values(pastSession.actionQueue) as IncomingAction[];
            // Filter ALL file chunks instead of using .find()
            const fileChunks = actions.filter(a => a.status === "FILE_CHUNK");
            for (const fileChunk of fileChunks) {
              if (fileChunk?.data?.files) {
                for (const file of fileChunk.data.files) {
                  if (!EXCLUDED_FILES.has(file.name.toLowerCase())) {
                    accumulatedFiles.set(file.name, file.content);
                  }
                }
              }
            }
          }

          // 2. Iterate ALL history items for files (captures BOTH COMPLETE_RESULT and USER_MESSAGE files)
          if (pastSession.history) {
            const historyItems = Object.values(pastSession.history) as HistoryItem[];
            // Sort chronologically so newer files overwrite older ones
            historyItems.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            
            for (const item of historyItems) {
              if (item.data?.files) {
                try {
                  const parsedFiles = JSON.parse(item.data.files);
                  for (const f of parsedFiles) {
                    if (!EXCLUDED_FILES.has(f.name.toLowerCase())) {
                      accumulatedFiles.set(f.name, f.content);
                    }
                  }
                } catch (e) {
                  console.warn("Could not parse past session files", e);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("Error gathering past session files:", e);
    }

    // 3. Merge in any *newly* attached files from the current prompt
    for (const file of newAttachments) {
      accumulatedFiles.set(file.name, file.content);
    }

    // 4. Push the fully updated file state to the new session
    const finalFilesToUpload = Array.from(accumulatedFiles.entries()).map(([name, content]) => ({
      name,
      content
    }));

    if (finalFilesToUpload.length > 0) {
      push(child(sessionRef, "actionQueue"), {
        status: "FILE_CHUNK",
        data: {
          files: finalFilesToUpload
        },
      } satisfies IncomingAction);
    }
    
    push(child(sessionRef, "actionQueue"), {
      status: "START_TASK",
      data: {},
    } satisfies IncomingAction);
    
    fetch("/s/run-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionRef.key }),
    });

    navigate(`/projects/${projectId}/session/${newSessionId}`);
    return true;
  };

const handleDeleteProject = async () => {
    if (!projectId || !project || !user) return;

    // 1. Check ownership
    if (project.ownerId !== user.uid) {
      console.error("Authorization failed: Requester is not the project owner.");
      alert("You can only delete projects you own.");
      return;
    }

    // 2. Confirmation
    const confirmed = window.confirm(
      `Are you sure you want to delete project "${project.title}" AND all of its sessions? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        // Get ID token for authorization
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error("User not authenticated or token unavailable.");
        }

        // 3. Find and delete all associated sessions
        const sessionsRef = ref(db, SESSION_ROOT_PATH);
        const projectSessionsQuery = query(sessionsRef, orderByChild("metadata/projectId"), equalTo(projectId));
        const snapshot = await get(projectSessionsQuery);
        
        if (snapshot.exists()) {
          snapshot.forEach((childSnapshot) => {
            const sessionIdToDel = childSnapshot.key;
            if (sessionIdToDel) {
              // Abort the session agent
              push(ref(db, `${SESSION_ROOT_PATH}/${sessionIdToDel}/actionQueue`), { 
                status: "ABORT" 
              } satisfies IncomingAction);
              
              // Remove from the user's session list
              set(ref(db, `${USERINFO_ROOT_PATH}/${user.uid}/sessions/${sessionIdToDel}`), null);
              
              // Schedule actual session deletion to allow the abort to process
              setTimeout(() => {
                set(ref(db, `${SESSION_ROOT_PATH}/${sessionIdToDel}`), null);
              }, 3000);
            }
          });
        }

        // 4. Remove project from user's project list
        await set(ref(db, `${USERINFO_ROOT_PATH}/${user.uid}/projects/${projectId}`), null);

        // 5. Send DELETE request to server for the project
        const response = await fetch(`/s/delete-project/${projectId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${idToken}`,
          },
        });

        if (response.ok) {
          console.log(`Project ${projectId} deleted successfully.`);
          // 6. Redirect to dashboard
          navigate('/');
        } else {
          // Attempt to parse JSON error response, fall back to status text
          const errorText = await response.text();
          let errorMessage = response.statusText;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch (e) {
            // Not JSON, use status text
          }
          
          console.error("Failed to delete project:", response.status, errorMessage);
          alert(`Failed to delete project: ${errorMessage}`);
        }
      } catch (error) {
        console.error("Error during project deletion:", error);
        alert("An unexpected error occurred during deletion.");
      }
    }
  };

  const requestSessionFeedback = () => {
    if (!sessionId) return;
    // Note: Because this uses sendMessage, it will appear as a "User" message 
    // asking the agent how the run went. 
    sendMessage("In the context of the overarching research project objectives, and the specific research task you were asked to complete—how well did you complete the current research task? What is missing? How close are we to reaching our overall objective?");
  };

  const handleStopCurrentSession = async () => {
    if (!sessionId) return;
    
    try {
      const response = await fetch("/s/stop-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
 
      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || response.statusText;
        } catch (e) {}
        alert(`Failed to stop task: ${errorMessage}`);
      }
    } catch (e) {
      alert(`Network error: ${e}`);
    }
  };

const generateProposedTasks = async (_currentSessionHistoryItems: HistoryItem[]): Promise<string[]> => {
    if (!prefs.geminiApiKey || !projectId || !project || !sessionId) return [];

    setIsGeneratingTasks(true);
    try {
      // 1. Define the specific objectives for this LLM call
      const taskObjective = `You are an expert Research Agent Coordinator. Your goal is to propose the next best research tasks to advance the Overall Objective.  Based on the overarching Research Project Definition, the progress from past tasks, and the detailed log of the most recent task, propose **no more than four** clear, actionable research tasks that could provide a better or more comprehensive result for the overall project, or builds on the results from the most recently completed task. Rank them so that any deliverables required to complete the project are listed first. Don't give them titles or headings, format each propsed task so that it can be provided directly to the Research Agent.`;
      
      const outputFormat = `Return ONLY a JSON array of strings representing your ordered list of proposed research tasks. Example: ["Do research tas.", "Do other research task."]`;

      // 2. Use the standardized utility to build the prompt
      const prompt = await buildProjectContextPrompt(
        projectId, 
        sessionId, 
        project, 
        taskObjective, 
        outputFormat
      );

      // 3. Send to Gemini
      const responseText = await sendGeminiOneShot(prompt, prefs.geminiApiKey, DEFAULT_GEMINI_PRO_MODEL);

      if (responseText) {
        const cleanText = removeBacktickFences(responseText);
        const tasksArray = JSON.parse(cleanText);
        
        if (Array.isArray(tasksArray) && tasksArray.length > 0) {
          const tasksRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/proposedTasks`);
          
          // Push the newly generated tasks to Firebase
          tasksArray.forEach(taskTitle => {
             push(tasksRef, { title: String(taskTitle) });
          });

          return tasksArray.map(String);
        }
      }
    } catch (e) {
      console.error("Failed to generate proposed tasks", e);
    } finally {
      setIsGeneratingTasks(false);
    }
    return [];
  };

  if (loading || !project) {
    return <div className={styles.page}>Loading...</div>;
  }

  const isAnalyzing = !!project.activeAnalysisSessionId;
  const isOwner = user && user.uid === project.ownerId;
  const hasRepo = !!(project.githubUrl || project.repoPath);

  return (
    <div className={styles.page}>
      <div className={styles.leftNav}>
        <Link to="/" className={styles.logoHeader}>
          <Logo size={28} />
          <span>MoMoA Researcher</span>
        </Link>
        <div className={styles.sessionListContainer}>
          <SessionList 
            projectId={projectId} 
            onNavigated={() => {}}
          />
        </div>        
        {projectId && <ProjectFiles projectId={projectId} />}
      </div>

      <div className={styles.mainContent}>
        <Header 
          className={styles.header}
          actions={
            isOwner && (
              <Flex gap="3" align="center">
                <Button 
                  color="gray" 
                  variant="soft" 
                  size="2" 
                  onClick={handleRefreshProjectDetails}
                  disabled={isGeneratingProjectDetails || !sessionId}
                >
                  {isGeneratingProjectDetails ? (
                    <Spinner size="2" />
                  ) : (
                    <RefreshCwIcon size={14} style={{ marginRight: 4 }} />
                  )}
                  Refresh Name
                </Button>

                <Button color="red" variant="soft" size="2" onClick={handleDeleteProject}>
                  Delete Project
                </Button>
              </Flex>
            )
          }
          >
          <InlineTextEdit
            value={project.title}
            placeholder="Project Title"
            onChange={(newTitle) => updateProjectMetadata("title", newTitle)}
            size="5" 
            weight="bold"
            disabled={isAnalyzing}
          />
        </Header>

        {/* --- 2. SECONDARY SUB-HEADER (Repo & Session Info) --- */}
        <div className={styles.projectHeader} style={{ paddingTop: '16px', paddingBottom: '16px' }}>
          <Flex direction="column" gap="2" style={{ flexGrow: 1 }}>
            <div className={styles.descriptionRow}>
               {/* Display Session Title if active */}
               {sessionId ? (
                 <InlineTextEdit
                    value={sessionMeta?.title || "Loading Session..."}
                    placeholder="Session Title"
                    onChange={updateSessionTitle}
                    disabled={isAnalyzing}
                  />
               ) : (
                 <Text size="3" color="gray">Select a session from the sidebar to view logs</Text>
               )}
            </div>
            <div className={styles.repoRow}  style={{ paddingLeft: '8px' }}>
              <GitHubRepoSelector
                initialUrl={project.githubUrl}
                repoPath={project.repoPath}
                isLinked={hasRepo}
                onSave={(newUrl) => updateProjectMetadata("githubUrl", newUrl)}
              />
            </div>
          </Flex>
        </div>
        <div className={styles.dashboardGrid}>
          {/* 1. Session Log Viewer Panel (Moved to Left) */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <Flex align="center" gap="2">
                Session Log
                {effectiveStatus === "running" && (
                  <Badge color="blue" variant="soft">Running</Badge>
                )}
                {effectiveStatus === "failed" && (
                  <Badge color="red" variant="soft">Failed / Lost</Badge>
                )}
                {effectiveStatus === "complete" && (
                  <Badge color="green" variant="soft">Complete</Badge>
                )}
              </Flex>
              {sessionMeta?.status === "running" && sessionMeta?.runnerInstanceId && (
                <Button size="1" color="red" variant="soft" onClick={handleStopCurrentSession}>
                  <XIcon size={12} style={{ marginRight: 4 }} />
                  Stop Task
                </Button>
              )}
            </div>
            <div className={styles.panelBody} style={{ padding: 0 }}>
              {sessionId ? (
                <SessionProvider sessionId={sessionId}>
                  <SessionLogViewer />
                </SessionProvider>
              ) : (
                <Flex align="center" justify="center" style={{ height: '100%' }}>
                  <Text color="gray">No Session Selected</Text>
                </Flex>
              )}
            </div>
          </div>

          {/* 2. Session Chat Panel (Moved to Middle) */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              Chat
              <Tooltip content="Clear Chat Transcript">
                <IconButton size="1" variant="ghost" color="red" onClick={deleteTranscript}>
                  <Trash2Icon size={14} />
                </IconButton>
              </Tooltip>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.chatHistory}>
                {transcript.map((entry, index) => (
                  <div key={index} className={`${styles.chatMessage} ${entry.role === 'user' ? styles.userMessage : styles.modelMessage}`}>
                    <div className={styles.speaker}>{SPEAKER_LABELS[entry.role] || entry.role}</div>
                    <div className={styles.content}>
                        {entry.parts.map((part, i) => <ChatPart key={i} part={part} />)}
                    </div>
                  </div>
                ))}
                {isSending && (
                    <div className={`${styles.chatMessage} ${styles.modelMessage}`}>
                      <div className={styles.speaker}>{SPEAKER_LABELS['model']}</div>
                      <div className={styles.content}><Spinner size="2" /></div>
                    </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <div className={styles.chatFooter}>
              <PromptBox
                placeholder={
                  !sessionId ? "Select a session to chat" :
                  //sessionMeta?.status !== "complete" ? "Wait for session to complete to chat" :
                  "Ask a question about this session"
                }
                supportsAttachments={true}
                supportsGitHub={false}
                supportsImages={true}
                showNotWorkingBuildOption={false}
                onSubmit={async (prompt, { image, imageMimeType, attachments }) => {
                  const files = attachments
                    .filter((a) => a.type === "files")
                    .flatMap((a) => (a.type === "files" ? a.files : []))
                    .map((f) => ({ path: f.path, content: f.textContent }));
                  sendMessage(prompt, image, imageMimeType, files);
                  return true;
                }}
                disabled={isAnalyzing || !sessionId} //|| sessionMeta?.status !== "complete"}
              />
            </div>
          </div>

          {/* 3. Task Assignment Panel (Stays on Right) */}
          <div className={styles.columnRight}>
            <div className={styles.newTaskSection}>
              <h3>Start Followup Research</h3>
              <div className={styles.promptBoxWrapper}>
                <PromptBox
                  placeholder="Provide a followup research task"
                  onSubmit={newSession}
                  showNotWorkingBuildOption={false}
                  supportsGitHub={false}
                  supportsImages={true}
                  disabled={isAnalyzing}
                  supportsAttachments={!hasRepo}
                />
              </div>
            </div>

            <div className={styles.proposedTasks}>
              <Flex align="center" justify="between" mb="0">
                <h3 style={{ margin: 0 }}>Proposed Research Tasks</h3>
                <Tooltip content="Regenerate Tasks">
                  <IconButton 
                    size="1" 
                    variant="ghost" 
                    color="gray" 
                    onClick={handleForceRefreshTasks} 
                    disabled={isGeneratingTasks || !sessionId}
                  >
                    {isGeneratingTasks ? <Spinner size="1" /> : <RefreshCwIcon size={14} />}
                  </IconButton>
                </Tooltip>
              </Flex>

              <Flex align="center" gap="1" style={{ padding: '2px 8px', marginBottom: '0px' }}>
                <Checkbox 
                  size="1" 
                  checked={autoRunNext} 
                  onCheckedChange={(checked) => setAutoRunNext(!!checked)} 
                />
                <Text size="1" weight="medium" color="gray" style={{ cursor: 'default' }}>
                  Auto-run top suggestion (Client Side)
                </Text>
              </Flex>
              
              {tasks.map((task) => (
                <TaskCard 
                  key={task.id}
                  title={task.title}
                  onTitleChange={(newTitle: string) => updateTaskTitle(task.id, newTitle)}
                  onSubmit={() => newSession(task.title, { attachments: [], notWorkingBuild: false })}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
              
              {/* Optional: Show a subtle loading message if the list is empty while generating */}
              {isGeneratingTasks && tasks.length === 0 && (
                 <Text size="1" color="gray" align="center" mt="4">Generating tasks...</Text>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Nested Sub-Components (Tasks & Session Log Viewer extracted from SessionPage)*/
/* -------------------------------------------------------------------------- */

function TaskCard({ title, onTitleChange, onSubmit, onDelete }: any) {
    // [TaskCard logic identical to original]
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isHovered, setIsHovered] = useState(false);
  
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, [title]);
  
    return (
      <div 
        className={styles.taskCard} 
        onClick={() => textareaRef.current?.focus()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className={styles.iconSide}>
          {isHovered ? (
            <XIcon className={styles.deleteIcon} size={16} onClick={(e) => { e.stopPropagation(); onDelete(); }} />
          ) : (
            <LightbulbIcon className={styles.bulbIcon} size={16} />
          )}
        </div>
        <div className={styles.contentSide}>
          <textarea
            ref={textareaRef}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className={styles.taskTitleInput}
            rows={1}
          />
        </div>
        <Tooltip content="Send">
          <IconButton size="1" variant="ghost" color="gray" className={styles.actionButton} onClick={(e) => { e.stopPropagation(); onSubmit(); }}>
            <SendIcon size={14} />
          </IconButton>
        </Tooltip>
      </div>
    );
}

// --------------------------- Session Log Viewer Components --------------------------- //

function SessionLogViewer() {
  const { sessionRef, history, sessionLoading, metadata } = useSessionContext()!;
  
  const collapsedHistory = useMemo(() => {
    let result: HistoryItem[] = [];
    let buffer: HistoryItem | null = null;
    for (let item of history) {
      let prev = result[result.length - 1];
      if (item.status === "WORK_LOG" && prev?.status === "WORK_LOG") {
        prev.message = (prev.message || "") + (item.message || "");
        continue;
      }
      result.push(item);
    }
    if (buffer) result.push(buffer);
    return result;
  }, [history]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim()) return;
    push(child(sessionRef, "history"), {
      status: "USER_MESSAGE",
      message: prompt.trim(),
      timestamp: Date.now(),
      runnerInstanceId: "local-client",
    } satisfies HistoryItem);
    push(child(sessionRef, "actionQueue"), {
      status: "HITL_RESPONSE",
      answer: prompt.trim(),
    } satisfies IncomingAction);
    fetch("/s/run-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionRef.key }),
    });
  };

  if (sessionLoading) return <Flex p="4"><Spinner /></Flex>;

  return (
    <Flex direction="column" style={{ height: '100%' }}>
      <div className={styles.historyContainer} style={{ flexGrow: 1, overflowY: 'auto', padding: '16px' }}>
        <div className={styles.history}>
          {!history.length && (
            <div className={styles.zeroState}>
              <div className={styles.icon}><InfinityIcon size={24} /></div>
              <Text className="title" size="3" weight="medium">Start with a prompt</Text>
            </div>
          )}
          {collapsedHistory.map((item, index) => (
            <HistoryItemRenderer key={index} item={item} />
          ))}
          {metadata?.status === "running" && (
            <Flex align="center" gap="2" mt="4">
              <Spinner />
              <Text size="2" color="gray">Task is running...</Text>
            </Flex>
          )}
        </div>
      </div>
      <div className={styles.bottomActions} style={{ padding: '16px', borderTop: '1px solid var(--gray-5)' }}>
        {(metadata?.status === "pending" || metadata?.status === "running" || metadata?.status === "blocked") && (
          <PromptBox
            className={styles.promptBox}
            onSubmit={sendPrompt}
            showNotWorkingBuildOption={false}
            placeholder={metadata?.status === "blocked" ? "Reply to agent" : "Provide realtime guidance"}
          />
        )}
      </div>
    </Flex>
  );
}

function HistoryItemRenderer({ item }: { item: HistoryItem }) {
  const { prefs } = usePrefsContext();
  const { status, message } = item || {};

  switch (status) {
    case "USER_MESSAGE": {
      let files: Array<{name: string}> = [];
      try {
        if (item.data?.files) {
          files = JSON.parse(item.data.files);
        }
      } catch (e) {}

      return (
        <>
          <Text as="div" align="right" size="1" color="gray" mt="1"><Timestamp precise timestamp={item.timestamp} /></Text>
          <TextBlock className={styles.userMessage} text={message || ""} />
          {files.length > 0 && (
            <Flex gap="2" mt="2" wrap="wrap" justify="end">
              {files.map((file, i) => (
                <Badge key={i} color="blue" variant="soft">
                  <PaperclipIcon size={12} style={{marginRight: 4}} />
                  {file.name}
                </Badge>
              ))}
            </Flex>
          )}
        </>
      );
    }
    case "PARAMS_RECEIVED":
    case "CHUNK_RECEIVED":
    case "WORK_LOG":
      if (!prefs.showDebugInfo) return null;
      return (
        <ActivityBlock color="yellow" icon={BugIcon} label={status} subLabel={message}>
          {message && <pre className={styles.verboseLog} style={{ whiteSpace: "pre-wrap", fontSize: 12 }}><code>{message}</code></pre>}
        </ActivityBlock>
      );
    case "PROGRESS_UPDATES":
      return (
        <>
          {item.completed_status_message && <TextBlock text={item.completed_status_message} />}
          {item.current_status_message && <TextBlock text={item.current_status_message} />}
        </>
      );
    case "ERROR":
      return <ActivityBlock color="red" icon={AlertCircleIcon} label="Error" subLabel={message} />;
    case "COMPLETE_RESULT":
      return <CompletionResult item={item} />;
    case "HITL_QUESTION":
      return (
        <ActivityBlock icon={MessageCircleQuestionIcon} color="amber" defaultExpanded label="Agent needs input">
          <TextBlock style={{ color: "var(--amber-12)" }} text={message || "Awaiting human input."} />
        </ActivityBlock>
      );
    case "APPLY_FILE_CHANGE":
      return null;
    default:
      return (
        <ActivityBlock icon={InfoIcon} label={status} subLabel={message}>
          <pre>{JSON.stringify(item, null, 2)}</pre>
        </ActivityBlock>
      );
  }
}

function ActivityBlock({ icon, children, active, label, subLabel, doneLabel, className, defaultExpanded, color }: {
  children?: React.ReactNode; label: string; doneLabel?: string; icon: any; active?: boolean; subLabel?: string | React.ReactNode; defaultExpanded?: boolean; className?: string; color?: ButtonProps["color"];
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const Icon = icon;
  return (
    <div className={cn(styles.activityBlock, className)}>
      <Button className={styles.button} color={color || "gray"} variant="ghost" disabled={!children} onClick={() => setIsExpanded(!isExpanded)}>
        <Icon className={styles.icon} size={16} />
        {active ? label : doneLabel || label}
        {subLabel && <span className={styles.subLabel}>{subLabel}</span>}
        {children && (!active && !isExpanded ? <ChevronDownIcon size={12} /> : !active && isExpanded && <ChevronUpIcon size={12} />)}
      </Button>
      {children && isExpanded && <div className={styles.activityDetail}>{children}</div>}
    </div>
  );
}

function TextBlock({ text, className, ...props }: React.HTMLProps<HTMLDivElement> & { text: string }) {
  return (
    // Safely merge the classNames here so {...props} doesn't wipe them out
    <div className={cn(styles.textPart, styles.markdown, className)} {...props}>
      <ReactMarkdown components={{ 
        pre({ node, children, ...props }: any) { 
          return <pre className={styles.codeBlock} {...props}>{children}</pre>; 
        }, 
        code({ node, className, children, ...props }: any) { 
          return <code className={className} {...props}>{children}</code>; 
        }
      }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CompletionResult({ item }: { item: HistoryItem }) {
  const data = item.data || {};
  const safeString = (value: any) => (typeof value === 'string' || value === null || value === undefined) ? (value || "N/A") : String(value);

  const files = useMemo(() => {
    try {
      let files = JSON.parse(data.files || "[]") as Array<{ name: string; content: string; }>;
      for (let file of files) file.content = b64decode(file.content);
      return files;
    } catch (e) { return []; }
  }, [data]);

  return (
    <>
      <ActivityBlock defaultExpanded icon={CheckIcon} label="Summary" color="green">
        <TextBlock style={{ color: "var(--green-12)" }} text={safeString(data.result)} />
      </ActivityBlock>
      <ActivityBlock icon={MessageCircleReplyIcon} color="orange" label="Feedback" subLabel={(safeString(data.feedback)).substring(0, 20) + "..."}>
        <TextBlock style={{ color: "var(--orange-12)" }} text={safeString(data.feedback)} />
      </ActivityBlock>
      <ActivityBlock icon={GraduationCapIcon} color="cyan" label="Retro" subLabel={(safeString(data.retrospective)).substring(0, 20) + "..."}>
        <TextBlock style={{ color: "var(--cyan-12)" }} text={safeString(data.retrospective)} />
      </ActivityBlock>
      {files.map((file, index) => (
        <Fragment key={index}>
          {file.name === "project.diff" ? (
            <PatchViewer patch={file.content} fullFiles={files} />
          ) : (
            <ActivityBlock key={index} icon={FileIcon} label={`File: ${file.name}`} color="cyan">
              <pre className={styles.verboseLog} style={{ whiteSpace: "pre-wrap", fontSize: 12 }}><code>{file.content}</code></pre>
            </ActivityBlock>
          )}
        </Fragment>
      ))}
    </>
  );
}