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

import { Button, DropdownMenu, IconButton, Tooltip } from "@radix-ui/themes";
import cn from "classnames";
import styles from "./AuthAvatar.module.scss";
import { useAuthContext } from "./AuthProvider";
import { Avatar } from "./Avatar";

export function AuthAvatar({ className }: { className?: string }) {
  const { user, signOut, signIn } = useAuthContext();
  if (!user) {
    return <Button onClick={() => signIn()}>Sign in</Button>;
  }

  return (
    <DropdownMenu.Root>
      <Tooltip content={user.displayName}>
        <DropdownMenu.Trigger className={cn(styles.avatarButton, className)}>
          <IconButton variant="ghost" color="gray" radius="full">
            <Avatar
              className={styles.avatar}
              src={user.photoURL}
              displayName={user.displayName}
            />
          </IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Content>
        <DropdownMenu.Item className="is-secondary" onClick={() => signOut()}>
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
