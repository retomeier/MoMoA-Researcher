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

import { useState, useEffect } from 'react';
import { Button, Text, Popover, Flex, TextField } from "@radix-ui/themes";
import { GithubIcon, PaperclipIcon } from "lucide-react";

interface GitHubRepoSelectorProps {
  initialUrl?: string;
  onSave: (url: string) => void;
  isLinked?: boolean; 
  repoPath?: string;
  triggerText?: string;
}

export function GitHubRepoSelector({ 
  initialUrl = "", 
  onSave, 
  isLinked = false, 
  repoPath,
  triggerText = "Link GitHub Repository"
}: GitHubRepoSelectorProps) {
  const [repoInput, setRepoInput] = useState(initialUrl);

  useEffect(() => {
    setRepoInput(initialUrl);
  }, [initialUrl]);

  const effectiveUrl = initialUrl || repoPath;
  const displayLinked = isLinked && effectiveUrl;

  const handleSave = () => {
    onSave(repoInput);
  };

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button 
          variant="ghost" 
          size="1" 
          color="gray" 
          style={{ gap: 6, padding: 0, fontWeight: 'normal', color: 'var(--gray-10)', cursor: 'pointer' }}
        >
          {displayLinked ? (
            <>
              <GithubIcon size={14} />
              <Text>{effectiveUrl}</Text>
            </>
          ) : (
            <>
              <PaperclipIcon size={14} />
              {triggerText}
            </>
          )}
        </Button>
      </Popover.Trigger>
      
      <Popover.Content width="320px">
        <Flex direction="column" gap="3">
          <Text size="2" weight="medium">
            {displayLinked ? "Edit Repository" : "Connect Repository"}
          </Text>
          <TextField.Root 
            placeholder="https://github.com/owner/repo" 
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
          >
            <TextField.Slot>
              <GithubIcon size={14} />
            </TextField.Slot>
          </TextField.Root>
          <Flex gap="2" justify="end">
            <Popover.Close>
              <Button variant="soft" color="gray" size="1">Cancel</Button>
            </Popover.Close>
            <Popover.Close>
              <Button 
                size="1" 
                onClick={handleSave}
              >
                Save
              </Button>
            </Popover.Close>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
