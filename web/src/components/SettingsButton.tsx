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
} from "@radix-ui/themes";
import { Settings2Icon } from "lucide-react";

export function SettingsButton() {
  const { prefs, runtimeConfig, updatePrefs } = usePrefsContext();
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
            {!areRequiredPrefsSet(prefs, runtimeConfig) && (
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
        <Flex direction="column" gap="2">
          <RequiredPrefs />
          <label style={{ cursor: "pointer" }}>
            <Flex gap="2" align="center">
              <Switch
                checked={prefs.showDebugInfo}
                size="1"
                onClick={() =>
                  updatePrefs({ showDebugInfo: !prefs.showDebugInfo })
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
