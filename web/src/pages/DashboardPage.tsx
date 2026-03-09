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

import { SessionMetadata } from "@/document/model-and-db";
import { Text } from "@radix-ui/themes";
import { child, push, ref, set, update } from "firebase/database";
import { encode as b64encode } from "js-base64";
import { Link, useNavigate } from "react-router-dom";
import {
  HistoryItem,
  IncomingAction,
  InitialRequestData,
  SESSION_ROOT_PATH,
  USERINFO_ROOT_PATH,
  PROJECT_ROOT_PATH, 
} from "../../../src/shared/model";
import { useAuthContext } from "../auth/AuthProvider";
import { Header } from "../components/Header";
import { Logo } from "../components/Logo";
import { PromptBox, PromptExtras } from "../components/PromptBox";
import { SessionList, SessionListHandle } from "../components/SessionList";
import { generateId } from "../document/util";
import { db } from "../firebase";
import { usePrefsContext } from "../util/PrefsProvider";
import styles from "./DashboardPage.module.scss";
import { useEffect, useRef } from "react";

export function DashboardPage() {
  const { user } = useAuthContext();
  const { prefs } = usePrefsContext();
  const sessionListRef = useRef<SessionListHandle>(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `MoMoA Researcher`;
  }, []);

  const newSession = async (
    prompt: string,
    { attachments, notWorkingBuild, image, imageMimeType }: PromptExtras
  ): Promise<boolean> => {
    if (!prompt.trim() || !user) return false;
    
    const projectId = generateId();
    const sessionId = generateId();

    // 1. Create the new Project
    const projectRef = ref(db, `${PROJECT_ROOT_PATH}/${projectId}/metadata`);
    await set(projectRef, {
      title: "New Project",
      ownerId: user.uid,
      createdAt: Date.now(),
      initialPrompt: prompt.trim()
    });
    
    // Link Project to User
    set(ref(db, `${USERINFO_ROOT_PATH}/${user.uid}/projects/${projectId}`), true);

    // 2. Create the Session
    set(
      ref(db, `${USERINFO_ROOT_PATH}/${user.uid}/sessions/${sessionId}`),
      true
    );
    const sessionRef = ref(db, `${SESSION_ROOT_PATH}/${sessionId}`);
    update(child(sessionRef, "metadata"), {
      startedAt: Date.now(),
      status: "pending",
      title: "New session",
      projectId: projectId, // Link session to the newly created project
    } satisfies SessionMetadata);

    push(child(sessionRef, "history"), {
      status: "USER_MESSAGE",
      message: prompt.trim(),
      timestamp: Date.now(),
      runnerInstanceId: "local-client",
    } satisfies HistoryItem);

    const requestData: InitialRequestData = {
      secrets: {
        geminiApiKey: prefs.geminiApiKey || "",
        githubScratchPadRepo: prefs.githubScratchPad || "",
        githubToken: prefs.githubToken || "",
        julesApiKey: prefs.julesApiKey || "",
        stitchApiKey: prefs.stitchApiKey || "",
        e2BApiKey: prefs.e2BApiKey || ""
      },
      githubUrl: (attachments.find((a) => a.type === "git-repo")?.repoUrl || null) as string | undefined,
      image: image || "",
      imageMimeType: imageMimeType || "",
      llmName: "gemini-2.5-flash",
      prompt: prompt.trim(),
      notWorkingBuild: notWorkingBuild,
    };

    requestData.assumptions = "* If the Project Definition implies that the project files have been provided and should be available, but there are no files available to you, you MUST seek clarification from the user.";
    if (notWorkingBuild) {
      requestData.assumptions +=
        "\n* The files provided are not part of a working build or test environment. DO NOT try to make the project build, or create or run any tests.";
    }

    push(child(sessionRef, "actionQueue"), {
      status: "INITIAL_REQUEST_PARAMS",
      data: requestData,
    } satisfies IncomingAction);

    if (attachments.length > 0) {
      push(child(sessionRef, "actionQueue"), {
        status: "FILE_CHUNK",
        data: {
          files: attachments
            .filter((a) => a.type === "files")
            .flatMap((a) => a.files)
            .map(({ path, textContent }) => ({
              name: path,
              content: b64encode(textContent),
            })),
        },
      } satisfies IncomingAction);
    }
    push(child(sessionRef, "actionQueue"), {
      status: "START_TASK",
      data: {},
    } satisfies IncomingAction);

    // trigger session
    fetch("/s/run-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId: sessionRef.key }),
    });
    
    // 3. Navigate immediately to the newly created project and session
    navigate(`/projects/${projectId}/session/${sessionId}`);

    return true;
  };

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.top}>
        <div className={styles.lockup}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, textDecoration: 'none' }}>
            <Logo className={styles.logo} size={47} />
            <Text size="7" weight="bold">
              MoMoA Researcher
            </Text>
          </Link>
        </div>
        <PromptBox
          className={styles.promptBox}
          supportsAttachments
          placeholder="What experimental research would you like to begin?"
          onSubmit={newSession}
          showNotWorkingBuildOption={false}
          supportsGitHub={true}
          supportsImages={true}
        />
      </div>
      <SessionList ref={sessionListRef} fullCards className={styles.sessionList} />
    </div>
  );
}
