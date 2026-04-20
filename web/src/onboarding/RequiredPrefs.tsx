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


import JulesIcon from "@/icons/JulesIcon";
import { Prefs, usePrefsContext } from "@/util/PrefsProvider";
import { Flex, TextField, Tooltip } from "@radix-ui/themes";
import { FileCodeIcon, GithubIcon, KeyIcon, LayersIcon } from "lucide-react";

export function areRequiredPrefsSet(prefs: Prefs) {
  return (
    !!prefs.geminiApiKey
    // !!prefs.julesApiKey &&
    // !!prefs.githubToken &&
    // !!prefs.githubScratchPad
  );
}

export function RequiredPrefs() {
  const { prefs, updatePrefs } = usePrefsContext();
  return (
    <Flex direction="column" style={{ width: "100%" }} gap="2">
      <Flex direction="column" gap="2">
        <TextField.Root
          value={prefs.geminiApiKey || ""}
          placeholder="Gemini API key"
          onChange={(ev) =>
            updatePrefs({
              geminiApiKey: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Gemini API Key"></Tooltip>
            <KeyIcon size={16} />
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.githubToken || ""}
          placeholder="GitHub token"
          onChange={(ev) =>
            updatePrefs({
              githubToken: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Personal access token for GitHub">
              <GithubIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.julesApiKey || ""}
          placeholder="Jules API Key"
          onChange={(ev) =>
            updatePrefs({
              julesApiKey: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Jules API Key">
              <JulesIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.githubScratchPad || ""}
          placeholder="Github Scratchpad"
          onChange={(ev) =>
            updatePrefs({
              githubScratchPad: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Github Scratchpad">
              <FileCodeIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.stitchApiKey || ""}
          placeholder="Stitch API Key"
          onChange={(ev) =>
            updatePrefs({
              stitchApiKey: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Stitch API Key">
              <LayersIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
      </Flex>
    </Flex>
  );
}
