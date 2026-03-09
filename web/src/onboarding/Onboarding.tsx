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

import { AuthAvatar } from "@/auth/AuthAvatar";
import { useAuthContext } from "@/auth/AuthProvider";
import { Logo } from "@/components/Logo";
import { usePrefsContext } from "@/util/PrefsProvider";
import { Card, Heading, HeadingProps, Text, TextProps } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { Loading } from "../components/Loading";
import { InitialPrefsScreen } from "./InitialPrefsScreen";
import { InviteCodeScreen } from "./InviteCodeScreen";
import { LoginScreen } from "./LoginScreen";
import styles from "./Onboarding.module.scss";
import { areRequiredPrefsSet } from "./RequiredPrefs";
import { GodRays, MeshGradient } from "@paper-design/shaders-react";
import { areTermsAccepted, TermsScreen } from "./TermsScreen";

export function OnboardGate({ children }: React.PropsWithChildren) {
  const { user, hasAccess, authLoaded } = useAuthContext();
  const { prefs } = usePrefsContext();
  const [continueKey, setContinueKey] = useState(0);
  // only check on first mount to avoid kicking users out if they delete prefs
  const initialConfigDone = useMemo(
    () => areRequiredPrefsSet(prefs),
    [continueKey],
  );
  const termsAccepted = useMemo(() => areTermsAccepted(prefs), [continueKey]);

  if (!authLoaded) return <Loading />;
  if (!user) return <LoginScreen />;
  if (!hasAccess) return <InviteCodeScreen />;
  if (!termsAccepted) return <TermsScreen onContinue={() => setContinueKey((k) => k + 1)} />;
  if (!initialConfigDone)
    return (
      <InitialPrefsScreen onContinue={() => setContinueKey((k) => k + 1)} />
    );

  // fully onboarded
  return <>{children}</>;
}

function OnboardingContainer({ children }: React.PropsWithChildren) {
  const { user } = useAuthContext();
  return (
    <>
      {user && <AuthAvatar className={styles.avatar} />}
      <div className={styles.container}>
        <MeshGradient
          className={styles.backdrop}
          colors={["#2E2259", "#341947", "#2B2137"]}
          distortion={0.4}
          speed={1}
          grainMixer={1}
        />
        <GodRays
          className={styles.godrays}
          colors={["#2E2259", "#341947", "#2B2137"]}
          colorBloom="#2B2137"
          colorBack="#00000000"
          speed={2}
          offsetX={0}
          offsetY={0}
        />
        <Card size="4" className={styles.card}>
          {children}
        </Card>
      </div>
    </>
  );
}

export const Onboarding = {
  Container: OnboardingContainer,
  Logo: () => <Logo className={styles.logo} size={24} />,
  Image: ({ children }: React.PropsWithChildren) => (
    <div className={styles.image}>{children}</div>
  ),
  Title: ({ children, ...props }: React.PropsWithChildren<HeadingProps>) => (
    <Heading size="4" weight="medium" mb="2" {...props}>
      {children}
    </Heading>
  ),
  Description: ({ children, ...props }: React.PropsWithChildren<TextProps>) => (
    <Text
      style={{ maxWidth: 300, textWrap: "balance" }}
      as="p"
      color="gray"
      size="2"
      mb="5"
      {...props}
    >
      {children}
    </Text>
  ),
};
