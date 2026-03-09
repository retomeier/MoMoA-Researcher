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

import { useEffect, useState } from "react";
import { SESSION_ROOT_PATH } from "../../../src/shared/model";
import { equalTo, onValue, orderByChild, query, ref } from "firebase/database";
import { Spinner } from "@radix-ui/themes/components/spinner";
import { Text, Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { DownloadIcon, CopyIcon, FileIcon } from "lucide-react";
import { db } from "@/firebase";
import { encode as _b64encode, decode as b64decode } from "js-base64";
import styles from "../pages/ResearchProjectPage.module.scss";

/* --- New Project Files Component --- */
export const ProjectFiles: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [files, setFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    const sessionsRef = ref(db, SESSION_ROOT_PATH);
    const projectSessionsQuery = query(sessionsRef, orderByChild("metadata/projectId"), equalTo(projectId));

    const unsubscribe = onValue(projectSessionsQuery, (snapshot) => {
      const accumulated = new Map<string, string>();
      const EXCLUDED_FILES = new Set(["project.diff", "summary.xml", "project_plan.md", "validation_report.md"]);

      if (snapshot.exists()) {
        const pastSessions: any[] = [];
        snapshot.forEach((childSnap) => { pastSessions.push(childSnap.val()); });
        pastSessions.sort((a, b) => (a.metadata?.startedAt || 0) - (b.metadata?.startedAt || 0));

        for (const session of pastSessions) {
          // Process initial uploads
          if (session.actionQueue) {
            Object.values(session.actionQueue).forEach((action: any) => {
              if (action.status === "FILE_CHUNK" && action.data?.files) {
                action.data.files.forEach((f: any) => {
                  if (!EXCLUDED_FILES.has(f.name.toLowerCase())) accumulated.set(f.name, f.content);
                });
              }
            });
          }
          // Process Agent results
          if (session.history) {
            const completeItem: any = Object.values(session.history).find((h: any) => h.status === "COMPLETE_RESULT");
            if (completeItem?.data?.files) {
              try {
                const parsed = JSON.parse(completeItem.data.files);
                parsed.forEach((f: any) => {
                  if (!EXCLUDED_FILES.has(f.name.toLowerCase())) accumulated.set(f.name, f.content);
                });
              } catch (e) { console.warn("Parse error", e); }
            }
          }
        }
      }
      setFiles(Array.from(accumulated.entries()).map(([name, content]) => ({ name, content })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const downloadFile = (name: string, b64Content: string) => {
    const link = document.createElement("a");
    link.href = `data:application/octet-stream;base64,${b64Content}`;
    link.download = name;
    link.click();
  };

  const copyToClipboard = (b64Content: string) => {
    const text = b64decode(b64Content);
    navigator.clipboard.writeText(text);
  };

  const downloadAll = () => {
    files.forEach(f => downloadFile(f.name, f.content));
  };

  if (loading) return <Spinner size="1" />;
  if (files.length === 0) return null;

 return (
    <div className={styles.projectFilesSection} style={{ padding: '12px', borderTop: '1px solid var(--gray-5)', marginTop: 'auto' }}>
      <Flex align="center" justify="between" mb="2">
        <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase' }}>
          New & Edited Files
        </Text>
        <Tooltip content="Download All Files">
           <IconButton size="1" variant="ghost" onClick={downloadAll}>
             <DownloadIcon size={12} />
           </IconButton>
        </Tooltip>
      </Flex>
      <Flex direction="column" gap="1" style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {files.map((file) => (
          <Flex key={file.name} align="center" justify="between" style={{ padding: '4px 8px', backgroundColor: 'var(--gray-3)', borderRadius: '4px' }}>
            <Flex align="center" gap="2" style={{ overflow: 'hidden', flex: 1 }}>
              <FileIcon size={12} style={{ flexShrink: 0, color: 'var(--gray-9)' }} />
              <Text size="1" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {file.name}
              </Text>
            </Flex>
            <Flex gap="1">
              <Tooltip content="Copy Content">
                <IconButton size="1" variant="ghost" onClick={() => copyToClipboard(file.content)}>
                  <CopyIcon size={10} />
                </IconButton>
              </Tooltip>
              <Tooltip content="Download">
                <IconButton size="1" variant="ghost" onClick={() => downloadFile(file.name, file.content)}>
                  <DownloadIcon size={10} />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>
        ))}
      </Flex>
    </div>
  );
};