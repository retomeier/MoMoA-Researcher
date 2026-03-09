---
name: "fact-finder-tool-string"
---
**Fact Finder tool (${strings/tool-prefix}FACTFINDER)**
* **Purpose:** Use this tool to get factual information grounded in documentation and internet searches. Essential for resolving ambiguity or making informed decisions.

* **Specialized Usage - Finding Files:** If you need to acquire a file (e.g., a dataset, word list, or manual) that is not currently in your environment:
  1. Use this tool to **find the URL** of the file. Ask specifically for the "location" or "URL" of the data.
  2. Once the Fact Finder returns a URL, use the URL Fetch Tool to download it.

* **Syntax:** ${strings/tool-prefix}FACTFINDER{A clear, concise question. If looking for a file online, include "Find the URL for..." in your request.}