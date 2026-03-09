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

import { useAuthContext } from "@/auth/AuthProvider";
import { useToast } from "@/components/Toast";
import { functions } from "@/firebase";
import { Flex, IconButton, TextField } from "@radix-ui/themes";
import cn from "classnames";
import { httpsCallable } from "firebase/functions";
import { ArrowRightIcon, CheckIcon, TicketIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import styles from "./Onboarding.module.scss";

export function InviteCodeScreen() {
  const { signOut, signIn } = useAuthContext();
  const [inviteCode, setInviteCode] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const submitAccessCode = async () => {
    if (submitting || !inviteCode.trim()) return;
    const exchangeInviteCode = httpsCallable(functions, "exchangeInviteCode");
    setError(false);
    try {
      setSubmitting(true);
      let result = await exchangeInviteCode({ inviteCode: inviteCode.trim() });
      if ((result as any).data?.success) {
        setSuccess(true);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await signOut();
        await signIn();
      } else {
        throw new Error("Unknown error");
      }
    } catch (error) {
      setError(true);
      toast((error as any).message || String(error), { status: "error" });
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Onboarding.Container>
      {success && (
        <>
          <Onboarding.Image>
            <CheckIcon />
          </Onboarding.Image>
          <Onboarding.Title>
            That worked! Signing in again&hellip;
          </Onboarding.Title>
        </>
      )}
      {!success && (
        <>
          <Onboarding.Image>
            <TicketIcon />
          </Onboarding.Image>
          <Onboarding.Title>Have an invite code?</Onboarding.Title>
          <Onboarding.Description>
            Access to this experiment is restricted.
          </Onboarding.Description>
          <Flex align="center" gap="2">
            <TextField.Root
              ref={inputRef}
              color={error ? "red" : undefined}
              className={cn(styles.inviteCodeField, {
                [styles.isError]: error,
              })}
              size="3"
              placeholder="Invite code"
              disabled={submitting}
              autoFocus
              value={inviteCode}
              onChange={(ev) => {
                setError(false);
                setInviteCode(ev.target.value.toUpperCase());
              }}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  submitAccessCode();
                }
              }}
            />
            <IconButton
              size="3"
              disabled={!inviteCode.trim()}
              loading={submitting}
              className={styles.cta}
              onClick={() => submitAccessCode()}
            >
              <ArrowRightIcon size={16} />
            </IconButton>
          </Flex>
        </>
      )}
    </Onboarding.Container>
  );
}
