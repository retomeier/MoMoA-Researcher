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

import { AuthProvider } from "@/auth/AuthProvider";
import { ToastProvider } from "@/components/Toast";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./App.scss";
import { OnboardGate } from "./onboarding/Onboarding";
import { DashboardPage } from "./pages/DashboardPage";
import { PrefsProvider } from "./util/PrefsProvider";
import { ResearchProjectPage } from "./pages/ResearchProjectPage";

export function App() {
  return (
    <PrefsProvider>
      <AuthProvider>
        <ToastProvider>
          <div className="app">
            <OnboardGate>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  
                  {/* Route for when a project is opened but no session is selected yet */}
                  <Route
                    path="/projects/:projectId"
                    element={<ResearchProjectPage />}
                  />
                  
                  {/* Route for when a specific session is selected within a project */}
                  <Route
                    path="/projects/:projectId/session/:sessionId"
                    element={<ResearchProjectPage />}
                  />
                </Routes>
              </BrowserRouter>
            </OnboardGate>
          </div>
        </ToastProvider>
      </AuthProvider>
    </PrefsProvider>
  );
}
