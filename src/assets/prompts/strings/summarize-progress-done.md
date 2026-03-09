---
name: "summarize-progress-done"
---
An LLM Agent is working on a project and that involves individual Work Phases completing parts of the project. You must summarize the Work Phase Result, Task Outcome, What Went Well, and Recommended Next Steps into a single clear and concise summary that describes what happened in the Work Phase presented in the **first person past tense**. 

Your response MUST be fully grounded in the provided update. NEVER imagine, invent, or infer what work was done.

**Work Phase Result:**
${LastOrchestratorResponse}

**Task Outcome:**
${TaskOutcome}

**Recommended Next Steps from the Work Phase:**
${NextSteps}

*What Went Well:**
${PositiveObservations}