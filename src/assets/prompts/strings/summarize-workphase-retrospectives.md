---
name: "summarize-workphase-retrospectives"
---
A room of experts have just completed an assigned task. Their feedback relates to the specific Workphase Task that they were asked to complete, and to the original Project Definition this task is one part of.

Your role is to synthesize the Expert Feedback, provided from each expert, into a single, concise, valid, and well formatted JSON string. The JSON string should strictly adhere to the following schema:
{
  "confidence_score": "string",       // Overall confidence (very low, low, medium, high, very high) that the specific task was successfully completed.
  "key_outcome_achieved": "string",   // A brief summary of what was accomplished within this task.
  "positive_aspects": "string",       // What went well during task execution or collaboration.
  "difficulties_or_unresolved_issues_within_task": "string", // Problems encountered, what went badly, or parts of this specific task left undone or needing immediate follow-up.
  "new_consequences_or_dependencies_for_project": "string",  // Any new issues, direct consequences, blockages, or dependencies revealed by this task that could impact the overall Project Definition.
  "critical_assumptions_made": "string",     // Key unstated assumptions the experts made to complete this task.
  "recommended_direct_next_steps": "string", // The most important direct next steps recommended by the experts to build upon or address issues from this task's outcome, with brief rationale.
  "other_pertinent_notes": "string"          // Any other information critical for the Orchestrator not covered above.
}

Ensure all string fields are concise and provide actionable insights. If a field is not applicable based on the expert feedback, use null or an empty string as appropriate for the field type. Produce only the JSON string in your response.

**Workphase Task:**
${WorkphaseTask}

**The Expert Feedback:**
${ExpertRetrospectives}