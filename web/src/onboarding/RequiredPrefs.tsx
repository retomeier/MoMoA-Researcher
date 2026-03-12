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
import { Prefs, RuntimeConfig, usePrefsContext } from "@/util/PrefsProvider";
import { Flex, Text, TextField, Tooltip } from "@radix-ui/themes";
import { GithubIcon, KeyIcon } from "lucide-react";

export function areRequiredPrefsSet(
  prefs: Prefs,
  runtimeConfig?: RuntimeConfig | null
) {
  return !!prefs.geminiApiKey || !!runtimeConfig?.hasGeminiApiKey;
}

export function RequiredPrefs() {
  const { prefs, runtimeConfig, updatePrefs } = usePrefsContext();
  const geminiConfigured = !!prefs.geminiApiKey || !!runtimeConfig?.hasGeminiApiKey;
  const githubConfigured = !!prefs.githubToken || !!runtimeConfig?.hasGithubToken;
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
            <KeyIcon size={16} />
          </TextField.Slot>
        </TextField.Root>
        {runtimeConfig?.hasGeminiApiKey && !prefs.geminiApiKey && (
          <Text size="1" color="gray">
            Gemini API key is already available from the server environment.
          </Text>
        )}
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
        {runtimeConfig?.hasGithubToken && !prefs.githubToken && (
          <Text size="1" color="gray">
            GitHub token is already available from the server environment.
          </Text>
        )}
        {(geminiConfigured || githubConfigured) && (
          <Text size="1" color="gray">
            Values entered here override the server environment for this browser.
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
