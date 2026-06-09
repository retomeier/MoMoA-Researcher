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
import { Text, Flex, IconButton, TextField, Tooltip } from "@radix-ui/themes";
import { CloudIcon, Code2Icon, CopyIcon, FileCodeIcon, GithubIcon, KeyIcon, LayersIcon, MonitorIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";

export function areRequiredPrefsSet(prefs: Prefs) {
  return (
    !!prefs.geminiApiKey
    // !!prefs.julesApiKey &&
    // !!prefs.githubToken &&
    // !!prefs.githubScratchPad
  );
}

export function RequiredPrefs() {
  // Helper to generate a secure random string for the agent key
  const generateAgentKey = () => {
    const array = new Uint8Array(24);
    window.crypto.getRandomValues(array);
    const key = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    updatePrefs({ remoteDesktopKey: key });
  };

  const copyCliCommand = () => {
    // Dynamically grab the current protocol and host (e.g., http://localhost:3007 or https://your-app.com)
    let serverUrl = window.location.origin.replace(":5173", ":3007");
    if (!serverUrl.includes(":"))
      serverUrl += ":3007";
    
    const command = `AGENT_ID="${prefs.remoteDesktopKey}" SERVER_URL="${serverUrl}" node localComputeCLI.mjs ./your-docs-folder`;
    navigator.clipboard.writeText(command);
  };

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
        <TextField.Root
          value={prefs.gcpProjectId || ""}
          placeholder="GCP Project ID"
          onChange={(ev) =>
            updatePrefs({
              gcpProjectId: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
        <TextField.Slot>
            <Tooltip content="GCP Project ID">
              <CloudIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.cloudWorkstationName || ""}
          placeholder="Cloud Workstation Name"
          onChange={(ev) =>
            updatePrefs({
              cloudWorkstationName: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Cloud Workstation Name">
              <MonitorIcon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>
        <TextField.Root
          value={prefs.e2BApiKey || ""}
          placeholder="E2B Dev Key"
          onChange={(ev) =>
            updatePrefs({
              e2BApiKey: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="E2B Dev Key">
              <Code2Icon size={16} />
            </Tooltip>
          </TextField.Slot>
        </TextField.Root>

      <hr style={{ border: '0', borderTop: '1px solid var(--gray-5)', margin: '8px 0' }} />
        <Text size="1" weight="bold" color="gray">Remote Desktop API Key</Text>

        <TextField.Root
          value={prefs.remoteDesktopKey || ""}
          placeholder="Local Agent Key"
          onChange={(ev) =>
            updatePrefs({
              remoteDesktopKey: ev.currentTarget.value,
            })
          }
          onFocus={(ev) => ev.currentTarget.select()}
        >
          <TextField.Slot>
            <Tooltip content="Remote Desktop Key">
              <TerminalIcon size={16} />
            </Tooltip>
          </TextField.Slot>
          <TextField.Slot>
             <Tooltip content="Generate new random key">
                <IconButton size="1" variant="ghost" onClick={generateAgentKey}>
                  <RefreshCwIcon size={14} />
                </IconButton>
             </Tooltip>
          </TextField.Slot>
        </TextField.Root>

        {/* Show CLI command helper if a key exists */}
        {prefs.remoteDesktopKey && (
          <Flex direction="row" align="center" gap="2" style={{ backgroundColor: 'var(--gray-3)', padding: '6px', borderRadius: '4px' }}>
            <Text size="1" color="gray" style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              AGENT_ID="{prefs.remoteDesktopKey.substring(0, )}..." SERVER_URL="http://host:port" node localComputeCLI.mjs ./your-docs-folder`;
            </Text>
            <Tooltip content="Copy CLI Command">
              <IconButton size="1" variant="ghost" onClick={copyCliCommand} style={{ marginLeft: 'auto' }}>
                <CopyIcon size={14} />
              </IconButton>
            </Tooltip>
          </Flex>
        )}

      </Flex>
    </Flex>
  );
}
