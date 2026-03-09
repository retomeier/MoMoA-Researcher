---
name: "project-restart-tool-string"
---
**Restart Project Tool (${strings/tool-prefix}RESTART_PROJECT)**
* **Purpose:** To stop the current project entirely and restart it from the very beginning. This is a **drastic** and **expensive** action.
* **Syntax:** ${strings/tool-prefix}RESTART_PROJECT{You MUST provide clear guidance for the new run inside the curly braces.}
* **Rules and Usage:**
  * This tool should only be used for **total project failure** (e.g., the core logic is flawed, key requirements are missing, and reverting files is not enough).
  * You **MUST** provide clear, actionable guidance for the *new* project run inside the `{}`. This guidance will be given to a brand new team.
  * When you use this tool, the current Work Phase will stop, all files will be reverted to their original state, and the project will restart.