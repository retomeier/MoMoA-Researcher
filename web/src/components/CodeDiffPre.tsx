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

import { ansiToHtml } from "anser";
import { niftty } from "niftty";
import { useEffect, useState } from "react";
import cn from "classnames";
import styles from "./CodeDiffPre.module.scss";
import { Spinner } from "@radix-ui/themes";

export function CodeDiffPre({
  before,
  after,
  filename,
  className,
}: {
  before: string;
  after: string;
  filename: string;
  className?: string;
}) {
  let [loading, setLoading] = useState(true);
  let [html, setHtml] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      let ansiDiff = await niftty({
        code: after,
        diffWith: before,
        filePath: filename,
        lineNumbers: "both",
        collapseUnchanged: {
          padding: 3,
        },
        theme: "github-dark-default",
      });
      if (cancel) return;
      setHtml(ansiToHtml(ansiDiff));
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [before, after, filename]);

  if (loading) return <div className={cn(styles.loading, className)}><Spinner /></div>;
  return (
    <pre
      dangerouslySetInnerHTML={{ __html: html }}
      className={cn(styles.codeDiff, className)}
    />
  );
}
