/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Prefs, usePrefsContext } from "@/util/PrefsProvider";
import { Button, ScrollArea } from "@radix-ui/themes";
import { ArrowRightIcon, BadgeInfoIcon } from "lucide-react";
import { Onboarding } from "./Onboarding";

export function areTermsAccepted(prefs: Prefs) {
  return !!prefs.termsAccepted;
}

export function TermsScreen({ onContinue }: { onContinue: () => void }) {
  const { updatePrefs } = usePrefsContext();
  return (
    <Onboarding.Container>
      <Onboarding.Image>
        <BadgeInfoIcon />
      </Onboarding.Image>
      <Onboarding.Title>Some words on privacy</Onboarding.Title>
      <ScrollArea
        type="always"
        scrollbars="vertical"
        mb="4"
        style={{
          textAlign: "left",
          fontSize: 13,
          paddingRight: 20,
          color: `var(--gray-11)`,
          maxHeight: 200,
        }}
      >
        <p>
          This notice and our{" "}
          <a href="https://policies.google.com/privacy" target="_blank">
            Privacy Policy
          </a>{" "}
          describe how /code handles your data. Please read them carefully.
        </p>
        <p>
          Google collects data you input into /code, such as your prompts,
          datasets, and code, as well as generated output, code execution
          results, related usage information, and your feedback. Google uses
          this data, consistent with our{" "}
          <a href="https://policies.google.com/privacy" target="_blank">
            Privacy Policy
          </a>
          , to provide, improve, and develop Google products and services and
          machine learning technologies, including Google’s enterprise products
          such as Google Cloud.
        </p>
        <p>
          To help with quality and improve our products (such as generative
          machine-learning models that power /code), human reviewers read,
          annotate, and process a sample of /code input and output. We take
          steps to protect your privacy as part of this process. This includes
          disconnecting this data from your Google Account before reviewers see
          or annotate it, and storing those disconnected copies for up to 18
          months. Please do not include sensitive (e.g., confidential) or
          personal information that can be used to identify you or others in
          your prompts or feedback.
        </p>
      </ScrollArea>
      <Button
        onClick={() => {
          updatePrefs({ termsAccepted: true });
          onContinue();
        }}
      >
        Got it
        <ArrowRightIcon size={16} />
      </Button>
    </Onboarding.Container>
  );
}