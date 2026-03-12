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

import "dotenv/config";
import express, { Application } from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import process from 'process';
import { getAuth } from 'firebase-admin/auth';
import { DEFAULT_GEMINI_MODEL, getConfiguredDefaultModel, getConfiguredLlmProvider } from './config/models.js';
import { initializeWebSocketServer } from './websocket_server';
import { abortSession, runSession, deleteProjectAndDependencies } from './firebase_server';

// --- Server Setup ---

const app: Application = express();
const port: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3007;
const llmProvider = getConfiguredLlmProvider();

function getLlmStartupSummary(): string[] {
  if (llmProvider === "openai-compatible") {
    return [
      `provider=${llmProvider}`,
      `model=${getConfiguredDefaultModel() || "unset"}`,
      `baseURL=${process.env.OPENAI_BASE_URL || "unset"}`,
      `apiKey=${process.env.OPENAI_API_KEY ? "set" : "missing"}`,
    ];
  }

  return [
    `provider=gemini`,
    `model=${getConfiguredDefaultModel() || DEFAULT_GEMINI_MODEL}`,
    `apiKey=${process.env.GEMINI_API_KEY ? "set" : "missing"}`,
  ];
}

// --- Server Initialization ---

const server: http.Server = http.createServer(app);

// Initialize the WebSocket server and attach it to the HTTP server
initializeWebSocketServer(port, server);

// Service sessions with state persisted in Firebase RTDB
app.use(cors());
app.get('/s/runtime-config', (_req, res) => {
    return res.json({
        hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
        hasGoogleApiKey: !!process.env.GOOGLE_API_KEY,
        hasGithubToken: !!process.env.GITHUB_TOKEN,
        hasJulesApiKey: !!process.env.JULES_API_KEY,
        hasStitchApiKey: !!process.env.STITCH_API_KEY,
        hasE2BApiKey: !!process.env.E2B_API_KEY,
        hasGithubScratchPadRepo: !!process.env.GITHUB_SCRATCHPAD_REPO,
    });
});
app.post('/s/run-session', express.json({ type: '*/*' }), async (req, res) => {
    const { sessionId } = req.body;

    try {
        // block until the session is done
        await runSession(sessionId);
        return res.status(200).json({ status: 'complete' });
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});
app.post('/s/stop-session', express.json({ type: '*/*' }), (req, res) => {
    try {
        const { sessionId } = req.body;
 
        if (!sessionId) {
            return res.status(400).json({ error: 'Missing sessionId' });
        }
 
        const aborted = abortSession(sessionId);
 
        if (aborted) {
            return res.status(200).json({ status: 'aborted', message: `Session ${sessionId} aborted successfully.` });
        } else {
            return res.status(404).json({ status: 'not_found', message: `Session ${sessionId} not found or already finished.` });
        }
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});

app.delete('/s/delete-project/:projectId', async (req, res) => {
    const projectId = req.params.projectId;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const requesterUid = decodedToken.uid;

        await deleteProjectAndDependencies(projectId, requesterUid);

        return res.status(200).json({ status: 'success', message: `Project ${projectId} deleted.` });
    } catch (error) {
        console.error(`Error processing project deletion for ${projectId}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Handle authorization/not found errors thrown by deleteProjectAndDependencies
        if (errorMessage.includes("Authorization failed") || errorMessage.includes("Project with ID")) {
            return res.status(403).json({ error: errorMessage });
        }
        
        // Handle Firebase token verification errors (e.g., expired, invalid)
        if (errorMessage.includes("Firebase ID token")) {
             return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
        }

        return res.status(500).json({ error: 'Internal server error during deletion.' });
    }
});

app.use(express.static('web/dist'));
app.get('*all', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'web/dist/index.html'));
});

server.listen(port, () => {
  console.log(`🚀 Server with WebSocket support is listening at http://localhost:${port}`);
  console.log(`[LLM] ${getLlmStartupSummary().join(" | ")}`);
});
