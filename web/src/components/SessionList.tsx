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

import { DropdownMenu, IconButton, Spinner, Text } from "@radix-ui/themes";
import cn from "classnames";
import { child, onValue, push, ref as databaseRef, set } from "firebase/database";
import { ChevronDownIcon, ChevronRightIcon, EllipsisVerticalIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  IncomingAction,
  PROJECT_ROOT_PATH,
  SESSION_ROOT_PATH,
  USERINFO_ROOT_PATH,
} from "../../../src/shared/model";
import { useAuthContext } from "../auth/AuthProvider";
import { ProjectMetadata, SessionMetadata } from "../document/model-and-db";
import { db } from "../firebase";
import styles from "./SessionList.module.scss";
import { Timestamp } from "./Timestamp";

// Helper types for grouping
type SessionWithId = SessionMetadata & { id: string };
type ProjectWithId = ProjectMetadata & { id: string };

interface ProjectGroup {
  project: ProjectWithId | null; // null for "No Project"
  sessions: SessionWithId[];
}

interface SessionRouteParams extends Record<string, string | undefined> {
  sessionId?: string;
  projectId?: string;
}

// Helper constant for the "No Project" group
const NO_PROJECT_KEY = "no-project";

// Helper constant for the "Shared" group
const SHARED_KEY = "shared-projects";
const SHARED_PROJECT_TEMPLATE: ProjectWithId = { 
  title: "Shared Project", 
  projectId: SHARED_KEY, 
  ownerId: "", 
  description: "", 
  id: SHARED_KEY 
};

// Define the handle interface
export interface SessionListHandle {
  expandNoProject: () => void;
}

export const SessionList = forwardRef<SessionListHandle, {
  className?: string;
  fullCards?: boolean;
  onNavigated?: () => void;
  projectId?: string;
}>(({
  className,
  fullCards,
  onNavigated,
  projectId,
}, ref) => {
  const { user } = useAuthContext();
  const userInfoRef = useMemo(
    () => (user ? databaseRef(db, `${USERINFO_ROOT_PATH}/${user.uid}`) : undefined),
    [user]
  );
  const sessionsRef = userInfoRef ? child(userInfoRef, "sessions") : undefined;
  const projectsRef = userInfoRef ? child(userInfoRef, "projects") : undefined;
  
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionMetadata>>({});
  const [projects, setProjects] = useState<Record<string, ProjectMetadata>>({});
  const { sessionId: activeSessionId } = useParams<SessionRouteParams>();

  // Ref to ensure default expansion logic runs only once
  const hasInitializedExpansion = useRef(false);

  // State for tracking expanded project groups
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set()
  );

  // 4. Grouping/Filtering Logic
  const groupedSessions = useMemo(() => {
    const allSessions: SessionWithId[] = sessionIds
      .map((id) => {
        const metadata = sessions[id];
        return metadata ? { ...metadata, id } : null;
      })
      .filter((s): s is SessionWithId => !!s)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)); // Sort by latest first

    if (projectId) {
      // Filtering Logic (Project Page Mode) - No change needed here
      return [
        {
          project: null,
          sessions: allSessions.filter((s) => s.projectId === projectId),
        },
      ];
    }

    // Hierarchy Logic (Sidebar Mode)
    const groups = new Map<string | null, ProjectGroup>();

    // Initialize "No Project" group
    groups.set(null, { project: null, sessions: [] });
    // Initialize "Shared Projects" group (NEW)
    groups.set(SHARED_KEY, { project: SHARED_PROJECT_TEMPLATE, sessions: [] });


    allSessions.forEach((session) => {
      const pId = session.projectId || null;
      
      if (pId === null) {
          // Case 1: Session has NO project ID. Go under "No Project"
          groups.get(null)!.sessions.push(session);
          return;
      }
      
      // Handle sessions with a project ID
      if (!groups.has(pId)) {
        const projectMetadata = projects[pId]; // Check if it's an owned/linked project
        if (projectMetadata) {
          // Case 2: Owned/Linked Project. Create a new group.
          groups.set(pId, {
            project: { ...projectMetadata, id: pId as string },
            sessions: [],
          });
        } else {
          // Case 3: Project ID exists but metadata is not loaded (Not owned/linked). Go under "Shared"
          groups.get(SHARED_KEY)!.sessions.push(session);
          return;
        }
      }
      
      // If the group exists, push the session to it (must be an owned project group)
      groups.get(pId)!.sessions.push(session);
    });

    // Convert map values to an array, ensuring "No Project" is first, "Shared" is second
    const result = Array.from(groups.values()).sort((a, b) => {
      const keyA = a.project?.id || NO_PROJECT_KEY;
      const keyB = b.project?.id || NO_PROJECT_KEY;

      // 1. "No Project" first
      if (keyA === NO_PROJECT_KEY) return -1;
      if (keyB === NO_PROJECT_KEY) return 1;

      // 2. "Shared" second (Uses the SHARED_KEY)
      if (keyA === SHARED_KEY) return -1;
      if (keyB === SHARED_KEY) return 1;

      // 3. Sort owned projects alphabetically by title
      // We can use a non-null assertion (!) here since 'no-project' and 'shared-projects' are handled above.
      return a.project!.title.localeCompare(b.project!.title);
    });

    // Filter out groups with no sessions (Keep 'No Project' if empty, filter 'Shared' if empty)
    return result.filter(group => group.sessions.length > 0 || group.project === null);
  }, [sessionIds, sessions, projects, projectId]);

  useImperativeHandle(ref, () => ({
    expandNoProject: () => {
      setExpandedProjectIds((prev) => {
        const next = new Set(prev);
        next.add(NO_PROJECT_KEY);
        return next;
      });
    },
  }));

  // Function to toggle expansion state
  const toggleProjectExpansion = useCallback((projectId: string | null) => {
    const key = projectId || NO_PROJECT_KEY; // Use NO_PROJECT_KEY
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Effect to reset the expansion guard when navigating to a new session
  useEffect(() => {
    hasInitializedExpansion.current = false;
  }, [activeSessionId]);

  // Effect to initialize expansion state based on the active session
  useEffect(() => {
    if (hasInitializedExpansion.current) {
      return;
    }

    if (!activeSessionId) {
      // If no active session (Root Path), collapse all immediately and set guard.
      setExpandedProjectIds(new Set());
      hasInitializedExpansion.current = true;
      return;
    }

    if (Object.keys(sessions).length === 0) {
      // If activeSessionId is present (Deep Link) but sessions haven't loaded, wait.
      return;
    }

    const activeSession = sessions[activeSessionId];
    if (activeSession) {
      const activeProjectId = activeSession.projectId || NO_PROJECT_KEY;
      // Only expand the project containing the active session
      setExpandedProjectIds(new Set([activeProjectId]));
      hasInitializedExpansion.current = true;
    } else {
      // Active session ID is present but metadata not found (e.g., deleted or still loading).
      // Check if the session list has loaded and the ID is truly invalid.
      if (sessionIds.length > 0 && !sessionIds.includes(activeSessionId)) {
        // ID is permanently invalid. Collapse all and set guard to prevent jitter.
        setExpandedProjectIds(new Set());
        hasInitializedExpansion.current = true;
      } else {
        // Still loading or ID might appear later. Default to collapsed and wait.
        setExpandedProjectIds(new Set());
        return;
      }
    }
  }, [activeSessionId, sessions, sessionIds]);

  // Effect to handle conditional default expansion
  useEffect(() => {
    // Only run if expansion hasn't been initialized by active session logic
    if (hasInitializedExpansion.current || activeSessionId) {
      return;
    }

    // Check if "No Project" is the only group present
    if (
      groupedSessions.length === 1 &&
      (groupedSessions[0].project === null || groupedSessions[0].project?.id === NO_PROJECT_KEY)
    ) {
      setExpandedProjectIds(new Set([NO_PROJECT_KEY]));
      hasInitializedExpansion.current = true;
    }
  }, [groupedSessions, activeSessionId]);

  // 1. Fetch Session IDs
  useEffect(() => {
    if (!sessionsRef) {
      setLoaded(true);
      return;
    }
    let unsub = onValue(
      sessionsRef,
      (ss) => {
        setSessionIds(Object.keys(ss.val() || {}));
        setLoadError(null);
        setLoaded(true);
      },
      (error) => {
        console.error("Failed to load sessions", error);
        setLoadError(error.message);
        setLoaded(true);
      }
    );
    return () => unsub();
  }, [String(sessionsRef)]);

  // 1.5. Fetch Project IDs from user's info (NEW)
useEffect(() => {
  if (!projectsRef) return;
  let unsub = onValue(projectsRef, (ss) => {
    setProjectIds(Object.keys(ss.val() || {}));
  });
  return () => unsub();
}, [String(projectsRef)]);

  // 2. Fetch Session Metadata for all IDs
  useEffect(() => {
    const sessionUnsubs: (() => void)[] = [];
    const newSessions: Record<string, SessionMetadata> = {};
    
    if (sessionIds.length === 0) {
      setSessions({});
      return;
    }

    sessionIds.forEach((id) => {
      const sessionMetadataRef = databaseRef(
        db,
        `${SESSION_ROOT_PATH}/${id}/metadata`
      );
      const unsub = onValue(sessionMetadataRef, (ss) => {
        const metadata = ss.val() as SessionMetadata;
        if (metadata) {
          newSessions[id] = metadata;
        } else {
          delete newSessions[id];
        }
        // Update state immediately on change for reactivity
        setSessions((prev) => ({ ...prev, [id]: metadata }));
      });
      sessionUnsubs.push(unsub);
    });

    return () => sessionUnsubs.forEach((unsub) => unsub());
  }, [sessionIds]);

  useEffect(() => {
    const projectUnsubs: (() => void)[] = [];
    const newProjects: Record<string, ProjectMetadata> = {};

    if (projectIds.length === 0) {
      setProjects({});
      return;
    }

    projectIds.forEach((id) => {
      // Project metadata is at the global path, but we only listen to the ones linked by the user's projectIds
      const projectMetadataRef = databaseRef(
        db,
        `${PROJECT_ROOT_PATH}/${id}/metadata`
      );
      const unsub = onValue(projectMetadataRef, (ss) => {
        const metadata = ss.val() as ProjectMetadata;
        if (metadata) {
          newProjects[id] = metadata;
        } else {
          delete newProjects[id];
        }
        // Update state immediately on change for reactivity
        setProjects((prev) => ({ ...prev, [id]: metadata }));
      });
      projectUnsubs.push(unsub);
    });

    return () => projectUnsubs.forEach((unsub) => unsub());
  }, [projectIds]);

  // 5. Rendering Logic
  if (!loaded) {
    return <Spinner className={styles.loadingSpinner} />;
  }

  if (loadError) {
    return (
      <Text size="1" color="red" className={styles.emptyState}>
        Failed to load sessions: {loadError}
      </Text>
    );
  }

  if (sessionIds.length === 0) {
    return (
      <Text size="1" color="gray" className={styles.emptyState}>
        Your sessions will appear here
      </Text>
    );
  }

  return (
    <div
      className={cn(
        styles.list,
        { [styles.isFullCards]: fullCards },
        className
      )}
    >
      {groupedSessions.map((group) => (
        <ProjectGroupComponent
          key={group.project?.id || NO_PROJECT_KEY}
          group={group}
          activeSessionId={activeSessionId ?? undefined}
          onNavigated={onNavigated}
          isProjectPage={!!projectId}
          isExpanded={expandedProjectIds.has(group.project?.id || NO_PROJECT_KEY)}
          onToggleExpansion={() => toggleProjectExpansion(group.project?.id || null)}
        />
      ))}
    </div>
  );
});

// 6. New ProjectGroupComponent
function ProjectGroupComponent({
  group,
  activeSessionId,
  onNavigated,
  isProjectPage,
  isExpanded,
  onToggleExpansion,
}: {
  group: ProjectGroup;
  activeSessionId?: string | null;
  onNavigated?: () => void;
  isProjectPage: boolean;
  isExpanded: boolean;
  onToggleExpansion: () => void;
}) {
  const { project, sessions } = group;
  
  // If we are on a Project Page, render flat list (unchanged)
  if (isProjectPage) {
    return (
      <>
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            isActive={session.id === activeSessionId}
            sessionId={session.id}
            onNavigated={onNavigated}
            metadata={session}
          />
        ))}
      </>
    );
  }

  // Determine the "Top" session (most recent)
  // sessions are already sorted (b.startedAt - a.startedAt) in the groupedSessions useMemo
  const topSession = sessions.length > 0 ? sessions[0] : null;
  const projectId = project?.id || NO_PROJECT_KEY;

  // Build the Target URL: 
  // If there's a top session, go to /projects/:pid/session/:sid
  // Otherwise, just go to the project root
  const targetUrl = topSession 
    ? `/projects/${projectId}/session/${topSession.id}`
    : `/projects/${projectId}`;

  const title = project ? project.title : "Tasks without Projects";
  const ToggleIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div className={styles.projectGroup}>
      <div className={styles.projectHeader}>
        {/* Toggle remains as a separate clickable icon */}
        <ToggleIcon 
          size={16} 
          className={styles.toggleIcon} 
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpansion();
          }} 
        />
        
        {/* Project Title is now a Link */}
        <Link 
          to={targetUrl} 
          className={styles.projectTitleLink}
          onClick={onNavigated}
          style={{ textDecoration: 'none', color: 'inherit', flexGrow: 1 }}
        >
          <Text size="2" weight="bold" className={styles.projectTitle}>
            {title}
          </Text>
        </Link>
      </div>
      
      {isExpanded && (
        <div className={styles.sessionChildren}>
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              isActive={session.id === activeSessionId}
              sessionId={session.id}
              onNavigated={onNavigated}
              metadata={session}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionItem({
  sessionId,
  isActive,
  onNavigated,
  metadata,
}: {
  sessionId: string;
  isActive?: boolean;
  onNavigated?: () => void;
  metadata: SessionMetadata;
}) {
  let { user } = useAuthContext();

  let effectiveStatus: SessionMetadata["status"] | undefined = metadata?.status;
  if (metadata?.status === "running" && !metadata.runnerInstanceId) {
    effectiveStatus = "failed";
  }

  // Determine the correct project ID for the route (fallback for legacy sessions)
  const projectRouteId = metadata?.projectId || NO_PROJECT_KEY;
  const targetUrl = `/projects/${projectRouteId}/session/${sessionId}`;

  return (
    <div
      className={styles.itemContainer}
      style={{ ["--order" as any]: Date.now() - (metadata?.startedAt ?? 0) }}
    >
      <Link
        data-status={effectiveStatus}
        className={cn(styles.item, {
          [styles.isActive]: isActive,
        })}
        onClick={onNavigated}
        to={targetUrl}
      >
        <div className={styles.statusDot} />
        <div className={styles.title}>{metadata?.title || "New session"}</div>
        <div className={styles.latestStatus}>
          {effectiveStatus === "complete"
            ? "Complete"
            : effectiveStatus === "failed"
            ? "Failed"
            : effectiveStatus === "blocked"
            ? "Needs your input"
            : effectiveStatus === "pending"
            ? "Pending"
            : metadata?.latestUpdate
            ? "Running: " + metadata?.latestUpdate
            : "Running"}
        </div>
        <div className={styles.subtitle}>
          <Timestamp timestamp={metadata?.startedAt} />
        </div>
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton
            className={styles.action}
            variant="ghost"
            color="gray"
            radius="full"
          >
            <EllipsisVerticalIcon size={16} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            onClick={() => {
              // abort the session
              push(databaseRef(db, `${SESSION_ROOT_PATH}/${sessionId}/actionQueue`), {
                status: "ABORT",
              } satisfies IncomingAction);

              // remove from the list of user sessions
              user &&
                set(
                  databaseRef(
                    db,
                    `${USERINFO_ROOT_PATH}/${user.uid}/sessions/${sessionId}`
                  ),
                  null
                );

              // in a few seconds, trigger actual deletion
              setTimeout(() => {
                set(databaseRef(db, `${SESSION_ROOT_PATH}/${sessionId}`), null);
              }, 3000);
            }}
          >
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
