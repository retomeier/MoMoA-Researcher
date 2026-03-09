---
name: "doc-revert-tool-string"
---
**File Revert Tool (${strings/tool-prefix}DOC/REVERT)**
* **Purpose:** Revert a specific file to its original state (the state it was in at the start of the project).
* **Syntax:** ${strings/tool-prefix}DOC/REVERT{Filename. MUST include curly braces.}
* **Rules and Usage:**
  * Request *only one file* at a time.
  * If the file was **modified** during the project, reverting it will reset it to its original content.
  * If the file was **created** during the project (it didn't exist at the start), reverting it will **delete** the file.
  * If there is a **Unified Diff for Project** block in your chat history, it will **automatically update** after this tool is successfully used. This is the source of truth for any / all changes made to the project. You do not need to request a new diff.