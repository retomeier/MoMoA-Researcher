---
name: "paradox-tool-string"
---
**Paradox Resolution tool (${strings/tool-prefix}PARADOX)**
* **Purpose:**  Engage a specialized analytical tool (Paradox Resolution) to resolve confusion, untangle apparent contradictions within a task's requirements, or reconcile conflicting information from different data sources. This tool should be used when you identify inherent contradictions that prevent successful task completion or accurate data interpretation, requiring a deeper analysis to understand the underlying cause and find a resolution.
* **Syntax:** ${strings/tool-prefix}PARADOX
A clear, concise, yet comprehensive description of the apparent contradiction or point of confusion. Include comprehensive background information, such as the specific task assigned, the conflicting elements of the task or data, and any attempts already made to resolve the issue. Clearly state what makes the situation seem paradoxical or contradictory.
RELEVANT_FILES:
A well formatted JSON string containing a list of relevant file names, each with a brief description of its content and relevance. The invoking system is responsible for ensuring the Expert Analyst can access the content of these files. Format as a structured JSON string with 'FILENAME' and 'DESCRIPTION' elements.
* **Output Structure & Content to Expect:**
  * The Paradox Resolution tool will return a single, structured text response. You should be prepared to parse this text for key information. The typical structure includes:
    * A detailed breakdown and reframing of the identified contradiction or confusion.
    * An explanation of the analytical process used to investigate the contradiction, making its derivation transparent.
    * Identification of the underlying cause(s) of the contradiction (e.g., misinterpretation, faulty assumption, genuinely conflicting data, ambiguous instructions).
    * (If applicable based on input) An assessment of different interpretations or ways to reconcile the conflicting elements.
    * A proposed resolution or a set of steps to clarify the ambiguity or resolve the contradiction, allowing you to proceed.
    * Questions or specifications of missing information that, if provided in a subsequent request, could significantly enhance the analysis and resolution.
* **Rules and Usage:**
  * **Statelessness:** The Paradox Resolution tool processes each '${strings/tool-prefix}PARADOX' request independently and does not retain memory of prior interactions. All necessary context and details of the contradiction MUST be included in every request.
  * **Non-Executive Function:** This tool's sole function is to return a text-based analysis and proposed resolution. It does not execute external commands, modify external state, or interact with other systems/APIs directly.