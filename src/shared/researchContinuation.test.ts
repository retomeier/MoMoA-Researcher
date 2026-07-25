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

import { parseResearchContinuationAssessment } from "./researchContinuation.js";

describe("parseResearchContinuationAssessment", () => {
  it("preserves a valid continuation decision", () => {
    const result = parseResearchContinuationAssessment({
      decision: "continue",
      rationale: "One material uncertainty remains.",
      objectiveCoverage: ["Primary hypothesis tested"],
      unresolvedQuestions: ["Does the result replicate?"],
      evidenceLimitations: ["Only one dataset was available"],
      expectedInformationGain: "high",
      proposedTasks: ["Replicate the experiment on the second dataset."],
    });

    expect(result.decision).toBe("continue");
    expect(result.proposedTasks).toEqual([
      "Replicate the experiment on the second dataset.",
    ]);
    expect(result.expectedInformationGain).toBe("high");
  });

  it("recognizes a legacy task-array response without auto-continuing", () => {
    const result = parseResearchContinuationAssessment([
      "Run a targeted replication.",
      "",
      "Compare the two results.",
    ]);

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual([
      "Run a targeted replication.",
      "Compare the two results.",
    ]);
    expect(result.evidenceLimitations).toContain(
      "The legacy response did not include a sufficiency assessment."
    );
  });

  it("withholds automatic continuation when no task is supplied", () => {
    const result = parseResearchContinuationAssessment({
      decision: "continue",
      rationale: "More research might be useful.",
      expectedInformationGain: "medium",
      proposedTasks: [],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual([]);
  });

  it("withholds automatic continuation when information gain is absent", () => {
    const result = parseResearchContinuationAssessment({
      decision: "continue",
      rationale: "Another adjacent experiment is possible.",
      expectedInformationGain: "none",
      proposedTasks: ["Run the adjacent experiment."],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual(["Run the adjacent experiment."]);
  });

  it("leaves a low-gain continuation task available for manual review", () => {
    const result = parseResearchContinuationAssessment({
      decision: "continue",
      rationale: "A minor adjacent question remains.",
      expectedInformationGain: "low",
      proposedTasks: ["Inspect the adjacent question."],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual(["Inspect the adjacent question."]);
    expect(parseResearchContinuationAssessment(result)).toEqual(result);
  });

  it("removes proposed tasks from a stop decision", () => {
    const result = parseResearchContinuationAssessment({
      decision: "stop_sufficient",
      rationale: "The objective is satisfied by converging evidence.",
      expectedInformationGain: "low",
      proposedTasks: ["Research an adjacent question."],
    });

    expect(result.decision).toBe("stop_sufficient");
    expect(result.proposedTasks).toEqual([]);
  });

  it("fails closed when sufficient stopping contradicts material uncertainty", () => {
    const result = parseResearchContinuationAssessment({
      decision: "stop_sufficient",
      rationale: "The objective appears satisfied.",
      unresolvedQuestions: ["Does the main result replicate?"],
      expectedInformationGain: "high",
      proposedTasks: [],
    });

    expect(result.decision).toBe("human_review");
    expect(result.unresolvedQuestions).toEqual([
      "Does the main result replicate?",
    ]);
  });

  it("allows a blocked decision to retain unresolved questions", () => {
    const result = parseResearchContinuationAssessment({
      decision: "stop_blocked",
      rationale: "The required private dataset is unavailable.",
      unresolvedQuestions: ["Does the result hold in the private dataset?"],
      evidenceLimitations: ["The private dataset is inaccessible."],
      expectedInformationGain: "none",
      proposedTasks: [],
    });

    expect(result.decision).toBe("stop_blocked");
    expect(result.unresolvedQuestions).toEqual([
      "Does the result hold in the private dataset?",
    ]);
  });

  it("preserves a valid assessment timestamp when reparsing stored data", () => {
    const result = parseResearchContinuationAssessment({
      decision: "human_review",
      rationale: "A scope decision belongs to the user.",
      expectedInformationGain: "none",
      proposedTasks: [],
      assessedAt: 1785012345678,
    });

    expect(result.assessedAt).toBe(1785012345678);
  });

  it("fails closed when the response is malformed", () => {
    const result = parseResearchContinuationAssessment({
      decision: "keep_going",
      rationale: "",
      proposedTasks: ["Continue automatically."],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual([]);
  });

  it("keeps candidate tasks available when human review is requested", () => {
    const result = parseResearchContinuationAssessment({
      decision: "human_review",
      rationale: "Continuing would change the agreed scope.",
      expectedInformationGain: "medium",
      proposedTasks: ["Narrow the objective to the primary dataset."],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual([
      "Narrow the objective to the primary dataset.",
    ]);
  });

  it("ignores an undeclared task field", () => {
    const result = parseResearchContinuationAssessment({
      decision: "continue",
      rationale: "One material uncertainty remains.",
      expectedInformationGain: "high",
      tasks: ["Run the follow-up experiment."],
    });

    expect(result.decision).toBe("human_review");
    expect(result.proposedTasks).toEqual([]);
  });

  it("returns the same assessment when stored output is parsed again", () => {
    const storedAssessments = [
      {
        decision: "continue",
        rationale: "A material question remains.",
        expectedInformationGain: "high",
        proposedTasks: ["Replicate the experiment."],
      },
      {
        decision: "continue",
        rationale: "Only an adjacent question remains.",
        expectedInformationGain: "low",
        proposedTasks: ["Explore the adjacent question."],
      },
      {
        decision: "stop_sufficient",
        rationale: "The objective is satisfied.",
        expectedInformationGain: "high",
      },
      {
        decision: "stop_sufficient",
        rationale: "The objective is satisfied.",
        expectedInformationGain: "low",
      },
      {
        decision: "stop_blocked",
        rationale: "The required dataset is unavailable.",
        expectedInformationGain: "high",
      },
      {
        decision: "human_review",
        rationale: "A scope decision is required.",
        expectedInformationGain: "medium",
        proposedTasks: ["Narrow the objective."],
      },
    ];

    for (const stored of storedAssessments) {
      const parsedOnce = parseResearchContinuationAssessment(stored);
      const parsedTwice = parseResearchContinuationAssessment(
        JSON.parse(JSON.stringify(parsedOnce))
      );

      expect(parsedTwice).toEqual(parsedOnce);
    }
  });
});
