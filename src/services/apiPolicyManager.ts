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

import { LlmBlockedError } from "../shared/errors.js";

export class ApiPolicyManager {
    // State is centralized here, shared across the application
    private lastSentTimestamps = new Map<string, number>(); 
    private consecutiveFailures = new Map<string, number>();
    private firstFailureTimestamp = new Map<string, number>();

    // Constants for policy
    private readonly BASE_RATE_LIMIT_MS = 2000;
    private readonly MAX_BACKOFF_DELAY_MS = 128000;
    private readonly PROLONGED_FAILURE_THRESHOLD_MS = 10 * 60 * 1000;

    private generateKey(apiName: string, modelName: string): string {
        return `${apiName}_${modelName}`;
    }

    public reportApiSuccess(apiName: string, modelName: string): void {
        const key = this.generateKey(apiName, modelName);
        if ((this.consecutiveFailures.get(key) ?? 0) > 0) {
            this.consecutiveFailures.set(key, 0);
            this.firstFailureTimestamp.delete(key);
        }
    }

    public reportApiFailure(apiName: string, modelName: string): void {
        const key = this.generateKey(apiName, modelName);
        const now = Date.now();
        const currentFailures = this.consecutiveFailures.get(key) ?? 0;

        if (currentFailures === 0) {
            this.firstFailureTimestamp.set(key, now);
        }
        this.consecutiveFailures.set(key, currentFailures + 1);
    }

    public async trackAndApplyPolicy(apiName: string, modelName: string): Promise<void> {
        const key = this.generateKey(apiName, modelName);
        const now = Date.now();

        // Check for prolonged failure before applying delay
        const firstFailure = this.firstFailureTimestamp.get(key);
        if (firstFailure && (now - firstFailure) >= this.PROLONGED_FAILURE_THRESHOLD_MS) {
            const errorMsg = `CRITICAL: API ${key} has been failing for a prolonged period.`;
            console.error(errorMsg);
            throw new LlmBlockedError(errorMsg);
        }

        // Calculate rate limit delay
        const lastSent = this.lastSentTimestamps.get(key) ?? 0;
        const timeSinceLast = now - lastSent;
        const rateLimitDelay = Math.max(0, this.BASE_RATE_LIMIT_MS - timeSinceLast);

        // Calculate exponential backoff delay
        let backoffDelay = 0;
        const failures = this.consecutiveFailures.get(key) ?? 0;
        if (failures > 0) {
            backoffDelay = Math.min(
                this.BASE_RATE_LIMIT_MS * Math.pow(2, failures),
                this.MAX_BACKOFF_DELAY_MS
            );
        }

        // Apply the greater of the two delays
        const totalDelay = Math.max(rateLimitDelay, backoffDelay);
        if (totalDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, totalDelay));
        }

        // Update timestamp *after* delay
        this.lastSentTimestamps.set(key, Date.now());
    }
}
