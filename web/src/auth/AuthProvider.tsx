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

import { auth } from "@/firebase";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  UserInfo,
} from "firebase/auth";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const MOCK_INFO = [
  { name: "Taylor", img: "52" },
  { name: "Charlene", img: "48" },
];

const AuthContext = createContext<{
  user: UserInfo | null;
  hasAccess: string | null;
  authLoaded: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}>({
  user: null,
  hasAccess: null,
  authLoaded: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function useAuthContext() {
  return useContext(AuthContext);
}

/**
 * Mostly just an auth gate.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [hasAccess, setHasAccess] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const signIn = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const _signOut = useCallback(async () => {
    await signOut(auth);
  }, []);

  useEffect(() => {
    let unsub = onAuthStateChanged(auth, async (user) => {
      let idTokenResult = await user?.getIdTokenResult();
      setAuthLoaded(true);
      setHasAccess(String(idTokenResult?.claims.hasAccess || "") || null);
      let mockId = new URLSearchParams(window.location.search).get("mock");
      if (!user) {
        setUser(null);
      } else if (mockId) {
        let { name, img } =
          MOCK_INFO[(Number(mockId) - 1) % MOCK_INFO.length] || MOCK_INFO[0];
        let slug = name.toLowerCase();
        setUser({
          email: `${slug}@example.com`,
          uid: `mock:${slug}`,
          photoURL: `https://i.pravatar.cc/150?img=${img}`,
          displayName: name,
          providerId: "google",
          phoneNumber: null,
        });
      } else {
        setUser(user);
      }
    });
    return () => unsub();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, hasAccess, authLoaded, signIn, signOut: _signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
