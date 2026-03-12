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

import { createContext, useContext, useState } from "react";
import { useEffect } from "react";

const PREFS_KEY = "momoa-researcher-app-prefs";

export type Prefs = {
  // app-specific!
  termsAccepted?: boolean;
  geminiApiKey?: string;
  julesApiKey?: string;
  stitchApiKey?: string;
  githubToken?: string;
  githubScratchPad?: string;
  showDebugInfo?: boolean;
  e2BApiKey?: string;
};

export type RuntimeConfig = {
  llmProvider: string;
  defaultModel: string;
  hasGeminiApiKey: boolean;
  hasOpenAIApiKey: boolean;
  hasGoogleApiKey: boolean;
  hasGithubToken: boolean;
  hasJulesApiKey: boolean;
  hasStitchApiKey: boolean;
  hasE2BApiKey: boolean;
  hasGithubScratchPadRepo: boolean;
};

const initialPrefs: Prefs = (() => {
  let prefsString = localStorage.getItem(PREFS_KEY);
  if (prefsString) {
    try {
      return JSON.parse(prefsString) as Prefs;
    } catch {}
  }
  return {};
})();

type PrefsContext = {
  prefs: Partial<Prefs>;
  runtimeConfig: RuntimeConfig | null;
  runtimeConfigLoaded: boolean;
  updatePrefs: (updates: Partial<Prefs>) => void;
};

const PrefsContext = createContext<PrefsContext>({} as PrefsContext);

export function usePrefsContext() {
  return useContext(PrefsContext);
}

export function PrefsProvider({ children }: React.PropsWithChildren) {
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/s/runtime-config")
      .then((response) => response.json())
      .then((config: RuntimeConfig) => {
        if (!cancelled) {
          setRuntimeConfig(config);
        }
      })
      .catch((error) => {
        console.error("Failed to load runtime config", error);
      })
      .finally(() => {
        if (!cancelled) {
          setRuntimeConfigLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updatePrefs(updates: Partial<Prefs>) {
    setPrefs((prefs) => {
      let newPrefs = {
        ...prefs,
        ...updates,
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(newPrefs));
      return newPrefs;
    });
  }

  return (
    <PrefsContext.Provider
      value={{ prefs, runtimeConfig, runtimeConfigLoaded, updatePrefs }}
    >
      {children}
    </PrefsContext.Provider>
  );
}
