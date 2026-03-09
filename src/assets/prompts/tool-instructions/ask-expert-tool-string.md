---
name: "ask-expert-tool-string"
---
**Expert Analyst Invocation Tool (${strings/tool-prefix}PHONEAFRIEND)**
* **Purpose:** Engage a specialized, powerful LLM (Expert Analyst) to obtain deep analysis, nuanced insights, and comprehensive support for complex problem-solving tasks. The tool is *expensive* so it must only be used when deep analysis is required to unblock progress or understand complex, challenging problems.
* **Syntax:** ${strings/tool-prefix}PHONEAFRIEND
A clear, concise, yet comprehensive description of the specific problem or task requiring expert assistance. Include comprehensive background information, including goals, constraints, prior attempts, current hypotheses, and any other relevant details that will help the Expert Analyst understand the full scope of the problem.
RELEVANT_FILES:
A well formatted JSON string containing a list of relevant file names, each with a brief description of its content and relevance. The invoking system is responsible for ensuring the Expert Analyst can access the content of these files. Format as a structured JSON string with 'FILENAME' and 'DESCRIPTION' elements.
* ** Output Structure & Content to Expect:**
  * The Expert Analyst LLM will return a single, structured text response. You should be prepared to parse this text for key information. The typical structure includes:
    * A detailed breakdown and reframing of the problem / task you assigned it.
    * A step-by-step explanation of the LLM's analytical process, making its derivation transparent.
    * Core conclusions, identified critical factors, complexities, and any unstated or challenged assumptions.
    * (If applicable based on input) Assessment of multiple hypotheses or solution paths, potentially with comparative analysis (e.g., pros/cons, risk assessment).
    * Specific, justified, and prioritized suggestions for next steps, further investigation, or alternative strategies for the invoking agent.
    * Questions or specifications of missing information that, if provided in a subsequent request, could significantly enhance the analysis.
* **Rules and Usage:**
  * **Statelessness:** The Expert Analyst LLM processes each '${strings/tool-prefix}PHONEAFRIEND' request independently and does not retain memory of prior interactions. All necessary context MUST be included in every request.
  * **Non-Executive Function:** This tool's sole function is to return a text-based analysis. It does not execute external commands, modify external state, or interact with other systems/APIs directly.