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

import { Button, Flex, IconButton } from "@radix-ui/themes";
import {
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  FileIcon,
} from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useState } from "react";
import {
  Diff,
  FileData,
  Hunk,
  markEdits,
  parseDiff,
  tokenize,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import styles from "./PatchViewer.module.scss";

export function PatchViewer({ 
    patch, 
    fullFiles = [] 
  }: { 
    patch: string; 
    fullFiles?: Array<{ name: string; content: string }>; 
  }) {
  const files = useMemo(() => {
    if (!patch.trim()) {
      return [];
    }

    try {
      return parseDiff(patch);
    } catch (e) {
      console.warn("Failed to parse patch:", e);
      return [];
    }
  }, [patch]);

  const [expanded, setExpanded] = useState<boolean[]>([]);
  const allExpanded = Array(files.length)
    .fill(0)
    .reduce((acc, _, i) => (expanded[i] ?? true) && acc, true);

  useEffect(() => setExpanded([]), [patch]);

  if (!files.length) {
    return null;
  }

  return (
    <div className={styles.patch}>
      <Flex gap="2" align="center" justify="end">
        <IconButton
          color="gray"
          variant="ghost"
          radius="full"
          onClick={() => {
            setExpanded(Array(files.length).fill(!allExpanded));
          }}
        >
          {allExpanded ? (
            <ChevronsDownUpIcon size={20} />
          ) : (
            <ChevronsUpDownIcon size={20} />
          )}
        </IconButton>
        <Button
          color="gray"
          variant="surface"
          onClick={async () => {
            const zip = new JSZip();

            // Create a lookup map for the full files provided by the server
            const fileMap = new Map(fullFiles.map(f => [f.name, f.content]));

            for (let file of files) {
              let path = file.newPath.trim();
              if (path.endsWith("ev/null")) continue;

              // Check if we have the full content from the server
              if (fileMap.has(path)) {
                zip.file(path, fileMap.get(path)!);
              } else {
                // Fallback to hunk reconstruction if full file is missing
                zip.file(
                  path,
                  file.hunks
                    ?.map((hunk) =>
                      hunk.changes
                        .filter((change) => change.type !== "delete")
                        .map((change) => change.content)
                        .join("\n")
                    )
                    .join("\n") || ""
                );
              }
            }
            
            let blob = await zip.generateAsync({ type: "blob" });
            saveAs(blob, "changes.zip");
          }}
        >
          <DownloadIcon size={16} />
          ZIP
        </Button>
        <Button asChild color="gray" variant="surface">
          <a
            download="changes.patch"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(patch)}`}
          >
            <DownloadIcon size={16} />
            Patch
          </a>
        </Button>
      </Flex>
      {files.map((file, i) => (
        <FileView
          key={[file.oldPath, file.newPath].join(":")}
          file={file}
          expanded={expanded[i] ?? true}
          onExpandedChange={(exp) =>
            setExpanded((prev) => ({ ...prev, [i]: exp }))
          }
        />
      ))}
    </div>
  );
}

function FileView({
  file,
  expanded,
  onExpandedChange,
}: {
  file: FileData;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { oldPath, newPath, type, hunks } = file;

  const { added, removed } = useMemo(() => {
    if (!hunks) {
      return { added: 0, removed: 0 };
    }

    let added = 0;
    let removed = 0;
    for (const hunk of hunks) {
      for (const change of hunk.changes) {
        if (change.type === "insert") {
          added++;
        } else if (change.type === "delete") {
          removed++;
        }
      }
    }
    return { added, removed };
  }, [hunks]);

  const tokens = useMemo(() => {
    if (!hunks) {
      return undefined;
    }

    try {
      return tokenize(hunks, {
        highlight: false,
        enhancers: [markEdits(hunks, { type: "block" })],
      });
    } catch (ex) {
      return undefined;
    }
  }, [hunks]);

  if (!tokens) {
    return <pre>Failed to tokenize hunks.</pre>;
  }

  return (
    <div className={styles.file}>
      <button
        className={styles.fileHeader}
        onClick={() => onExpandedChange(!expanded)}
      >
        <FileIcon size={16} />
        <div className={styles.fileLabel}>
          {!added &&
          newPath.trim().endsWith("ev/null") /* parser bug misses "/d" */
            ? oldPath
            : newPath}
        </div>
        <div className={styles.fileSummary}>
          {!!added && <span className={styles.added}> +{added}</span>}
          {!!removed && <span className={styles.removed}> -{removed}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
      </button>
      {expanded && (
        <Diff
          className={styles.diff}
          gutterType="default"
          viewType="unified"
          diffType={type}
          tokens={tokens}
          hunks={hunks}
        >
          {(hunks) =>
            hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
          }
        </Diff>
      )}
    </div>
  );
}
