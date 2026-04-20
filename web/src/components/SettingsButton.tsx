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

import { areRequiredPrefsSet, RequiredPrefs } from "@/onboarding/RequiredPrefs";
import { usePrefsContext } from "@/util/PrefsProvider";
import {
  Flex,
  IconButton,
  Popover,
  Switch,
  Text,
  Tooltip,
  Select,
} from "@radix-ui/themes";
import { Settings2Icon } from "lucide-react";

export function SettingsButton() {
  const { prefs, updatePrefs } = usePrefsContext();
  return (
    <Popover.Root>
      <Tooltip content="Settings">
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            style={{ position: "relative" }}
          >
            <Settings2Icon size={20} />
            {!areRequiredPrefsSet(prefs) && (
              <div
                style={{
                  position: "absolute",
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: "var(--red-10)",
                  top: 4,
                  right: 4,
                }}
              />
            )}
          </IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content width="360px">
        <Flex direction="column" gap="3"> {/* Increased gap for better spacing */}
          <RequiredPrefs />
          
          <hr style={{ border: '0', borderTop: '1px solid var(--gray-5)', margin: '4px 0' }} />

          {/* Tool Environment Selector */}
          <Flex direction="column" gap="1">
            <Text size="1" weight="bold" color="gray" mb="1">
              Code Tool Execution Environment
            </Text>
            <Select.Root 
              value={prefs.toolRunEnvironment || "Local"} 
              onValueChange={(value) => updatePrefs({ toolRunEnvironment: value })}
            >
              <Select.Trigger placeholder="Select tool execution environment..." />
              <Select.Content>
                <Select.Item value="LOCAL">Server's Host Environment</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <label style={{ cursor: "pointer" }}>
            <Flex gap="2" align="center">
              <Switch
                checked={prefs.showDebugInfo}
                size="1"
                onCheckedChange={(checked) => // Used onCheckedChange for better Radix compatibility[cite: 1]
                  updatePrefs({ showDebugInfo: checked })
                }
              />
              <Text color="gray" size="2" style={{ flexGrow: 1 }}>
                Show verbose task logs
              </Text>
            </Flex>
          </label>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
