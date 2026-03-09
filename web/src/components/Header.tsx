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

import { AuthAvatar } from "@/auth/AuthAvatar";
import { Separator } from "@radix-ui/themes";
import cn from "classnames";
import { PropsWithChildren } from "react";
import styles from "./Header.module.scss";
import { SendFeedbackButton } from "./SendFeedbackButton";
import { SettingsButton } from "./SettingsButton";

export function Header({
  className,
  children,
  actions,
}: PropsWithChildren<{
  className?: string;
  actions?: React.ReactNode;
}>) {
  return (
    <header className={cn(styles.header, className)}>
      <div className={styles.left}>{children}</div>
      <div style={{ flexGrow: 1 }} />
      <div className={styles.actions}>
        {actions}
        <Separator orientation="vertical" />
        <SettingsButton />
        <SendFeedbackButton feedbackKey="julesmomoa" />
      </div>
      <AuthAvatar />
    </header>
  );
}
