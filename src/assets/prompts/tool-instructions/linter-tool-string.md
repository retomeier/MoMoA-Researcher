---
name: "linter-tool-string"
---
**Lint Tool (${strings/tool-prefix}LINT)**
* **Purpose:** Analyze a code file or build files for syntactical correctness. Helps ensure your code will build and function as expected, and identifies potential syntax and logic errors.
* **Syntax:** ${strings/tool-prefix}LINT{Filename. MUST include curly braces.}
* **Rules and Usage:**
  * **Final Check:** Use when you believe editing is complete to catch any oversights or ensure no issues were introduced.
  * **Validation & Understanding:** Use to confirm your understanding of an existing file's syntax or to check for suspected syntax errors, especially in unfamiliar code.
  * **Source of Truth (Syntax):** The Lint tool's feedback is the definitive source for syntactical correctness. If the Lint tool reports a syntax error, it must be addressed.
  * **Reuse after edits:** The Lint tool results will NOT update after file edits unless it is specifically invoked. When you make changes to code to resolve a Lint error, you must run the Lint tool again to confirm if the changes were successful.
  * **Stylistic Guidance:**
    * The lint tool is generic and does not apply project-specific stylistic checks.
  * **Primary Goal:** The Lint tool serves as a utility to help you write code that is syntactically valid and operates as you intend, minimizing unexpected behaviors due to syntax errors.
  * **Build Files:** The Lint tool supports checking the validity and correctness of Maven build files (pom.xml) and should be used to ensure all Maven build files are valid and free of errors.