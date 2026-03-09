---
name: "file-revert-tool-string"
---
**Revert File Tool (${strings/tool-prefix}REVERT_FILE)**
* **Purpose:** Restore the file being edited to the state it was in before the _current_ attempt to edit the file.
* **Syntax:** ${strings/tool-prefix}REVERT_FILE
* **Rules and Usage:**
  * Use when your edits have made the file worse and you wish to try again. In that case you can revert the file to its prior state at the beginning of this effort to apply an edit. before either trying again or returning your response.
  * Use if you are convinced you will not be able to successfully edit the document and you wish to undo your changes before returning a failure response.
  * This tool will ONLY revert to edits applied in the current editing session. It will NOT revert to an earlier version.
  * After using this tool it is VERY IMPORTANT to review the file before making further edits. NEVER assume what the content of the file will be after using this tool.