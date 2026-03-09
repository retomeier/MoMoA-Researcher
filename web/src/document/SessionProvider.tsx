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

import { db } from "@/firebase";
import {
  child,
  DatabaseReference,
  onValue,
  ref,
  update,
} from "firebase/database";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { HistoryItem, SESSION_ROOT_PATH } from "../../../src/shared/model";
import { SESSION_METADATA_TEMPLATE, SessionMetadata } from "./model-and-db";

type SessionContext = {
  sessionLoading: boolean;
  sessionId: string;
  sessionRef: DatabaseReference;
  metadata: SessionMetadata | undefined;
  history: HistoryItem[];
  result?: HistoryItem;
  updateMetadata: (updates: Partial<SessionMetadata>) => void;
};

const SessionContext = createContext<SessionContext | undefined>(undefined);

export const SessionContextConsumer = SessionContext.Consumer;

export function useSessionContext() {
  return useContext(SessionContext);
}

type Props = {
  sessionId: string;
};

export function SessionProvider({
  sessionId,
  children,
}: React.PropsWithChildren<Props>) {
  const sessionRef = useMemo(
    () => ref(db, `${SESSION_ROOT_PATH}/${sessionId}`),
    [sessionId]
  );
  const metadataRef = child(sessionRef, "metadata");
  const [metadata, setMetadata] = useState<SessionMetadata>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [result, setResult] = useState<HistoryItem | undefined>();

  function updateMetadata(updates: Partial<SessionMetadata>) {
    setMetadata((metadata) => ({
      ...SESSION_METADATA_TEMPLATE,
      ...metadata,
      ...updates,
    }));
    update(metadataRef, updates);
  }

  // Observe doc metadata and content from RTDB
  useEffect(() => {
    let unsub = onValue(sessionRef, (ss) => {
      let val = ss.val();
      setMetadata(
        (val?.metadata ||
          structuredClone(SESSION_METADATA_TEMPLATE)) as SessionMetadata
      );
      setHistory(Object.values(val?.history || {}) as HistoryItem[]);
      setResult(val?.result || undefined);
    });
    return () => unsub();
  }, [sessionId]);

  return (
    <SessionContext.Provider
      value={{
        sessionLoading: !metadata,
        sessionId,
        sessionRef,
        metadata,
        history,
        result,
        updateMetadata,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
