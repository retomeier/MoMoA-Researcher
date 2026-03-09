---
name: "file-reading-tool-string"
---
**File Reading Tool (${strings/tool-prefix}DOC/READ)**
* **Purpose:** View the current contents of a text file, image file, or PDF.
* **Syntax:** ${strings/tool-prefix}DOC/READ{Filename. MUST include curly braces.}
* **Rules and Usage:**
  * Request *only one file* at a time. Wait for the response before requesting another.
  * If you have been provided with a list of files that exist, check to ensure the file you're requesting is available.