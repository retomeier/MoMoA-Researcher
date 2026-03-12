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

import { Button, Link } from "@radix-ui/themes";
import { ArrowRightIcon, Settings2Icon } from "lucide-react";
import { Onboarding } from "./Onboarding";
import styles from "./Onboarding.module.scss";
import { areRequiredPrefsSet, RequiredPrefs } from "./RequiredPrefs";
import { usePrefsContext } from "@/util/PrefsProvider";

export function InitialPrefsScreen({ onContinue }: { onContinue: () => void }) {
  const { prefs, runtimeConfig } = usePrefsContext();
  return (
    <Onboarding.Container>
      <Onboarding.Image>
        <Settings2Icon />
      </Onboarding.Image>
      <Onboarding.Title>Let's get set up</Onboarding.Title>
      <Onboarding.Description>
        For this experiment, you'll need to use your own{" "}
        <Link href="https://aistudio.google.com/api-keys">Gemini API key</Link>,{" "}
        and GitHub personal access token (to fetch GitHub projects).
      </Onboarding.Description>
      <RequiredPrefs />
      <Button
        mt="5"
        disabled={!areRequiredPrefsSet(prefs, runtimeConfig)}
        className={styles.cta}
        onClick={onContinue}
      >
        Continue
        <ArrowRightIcon size={16} />
      </Button>
    </Onboarding.Container>
  );
}
