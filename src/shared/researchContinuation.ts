/**
 * Copyright 2026 Guilherme Bombonatto
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

export type ResearchContinuationDecision =
  | "continue"
  | "stop_sufficient"
  | "stop_blocked"
  | "human_review";

export type ExpectedInformationGain = "high" | "medium" | "low" | "none";

export interface ResearchContinuationAssessment {
  decision: ResearchContinuationDecision;
  rationale: string;
  objectiveCoverage: string[];
  unresolvedQuestions: string[];
  evidenceLimitations: string[];
  expectedInformationGain: ExpectedInformationGain;
  proposedTasks: string[];
  assessedAt?: number;
}

const decisions = new Set<ResearchContinuationDecision>([
  "continue",
  "stop_sufficient",
  "stop_blocked",
  "human_review",
]);

const informationGains = new Set<ExpectedInformationGain>([
  "high",
  "medium",
  "low",
  "none",
]);

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const cleanStringArray = (value: unknown, limit = 12): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map(cleanString)
    .filter((item): item is string => item.length > 0)
    .slice(0, limit);
};

export const createHumanReviewAssessment = (
  rationale: string
): ResearchContinuationAssessment => ({
  decision: "human_review",
  rationale,
  objectiveCoverage: [],
  unresolvedQuestions: [],
  evidenceLimitations: [],
  expectedInformationGain: "none",
  proposedTasks: [],
});

/**
 * Converts model output into a fail-closed continuation decision.
 *
 * Older deployments returned a JSON array of tasks. Those responses remain
 * recognizable, but they cannot authorize another automatic research session
 * because they contain no explicit sufficiency assessment.
 */
export const parseResearchContinuationAssessment = (
  value: unknown
): ResearchContinuationAssessment => {
  if (Array.isArray(value)) {
    const proposedTasks = cleanStringArray(value, 4);

    return {
      decision: "human_review",
      rationale:
        proposedTasks.length > 0
          ? "A legacy task-only response was received without an explicit sufficiency assessment. Automatic continuation was withheld."
          : "No next task or explicit research-closure rationale was provided. Automatic continuation was withheld.",
      objectiveCoverage: [],
      unresolvedQuestions: [],
      evidenceLimitations: [
        "The legacy response did not include a sufficiency assessment.",
      ],
      expectedInformationGain: "none",
      proposedTasks,
    };
  }

  if (!value || typeof value !== "object") {
    return createHumanReviewAssessment(
      "The research-continuation assessment was missing or malformed."
    );
  }

  const record = value as Record<string, unknown>;
  const decision = cleanString(record.decision) as ResearchContinuationDecision;
  const rationale = cleanString(record.rationale);
  const proposedTasks = cleanStringArray(record.proposedTasks, 4);

  if (!decisions.has(decision) || !rationale) {
    return createHumanReviewAssessment(
      "The research-continuation assessment did not provide a valid decision and rationale."
    );
  }

  const expectedInformationGain = cleanString(
    record.expectedInformationGain
  ) as ExpectedInformationGain;
  const assessedAt =
    typeof record.assessedAt === "number" &&
    Number.isFinite(record.assessedAt) &&
    record.assessedAt > 0
      ? record.assessedAt
      : undefined;

  const assessment: ResearchContinuationAssessment = {
    decision,
    rationale,
    objectiveCoverage: cleanStringArray(record.objectiveCoverage),
    unresolvedQuestions: cleanStringArray(record.unresolvedQuestions),
    evidenceLimitations: cleanStringArray(record.evidenceLimitations),
    expectedInformationGain: informationGains.has(expectedInformationGain)
      ? expectedInformationGain
      : "none",
    proposedTasks,
    ...(assessedAt !== undefined ? { assessedAt } : {}),
  };

  if (assessment.decision === "continue" && proposedTasks.length === 0) {
    return {
      ...assessment,
      decision: "human_review",
      rationale: `${assessment.rationale} No actionable next task was supplied, so automatic continuation was withheld.`,
      expectedInformationGain: "none",
      proposedTasks: [],
    };
  }

  if (
    assessment.decision === "continue" &&
    (assessment.expectedInformationGain === "low" ||
      assessment.expectedInformationGain === "none")
  ) {
    return {
      ...assessment,
      decision: "human_review",
      rationale: `${assessment.rationale} The expected information gain was not sufficient to authorize another automatic session, so human review is required.`,
    };
  }

  if (
    assessment.decision === "stop_sufficient" &&
    (assessment.expectedInformationGain === "high" ||
      assessment.unresolvedQuestions.length > 0)
  ) {
    return {
      ...assessment,
      decision: "human_review",
      rationale: `${assessment.rationale} The claimed sufficiency conflicts with a high expected information gain or a material unresolved question, so human review is required.`,
      proposedTasks: [],
    };
  }

  if (
    assessment.decision === "stop_sufficient" ||
    assessment.decision === "stop_blocked"
  ) {
    return {
      ...assessment,
      proposedTasks: [],
    };
  }

  return assessment;
};
