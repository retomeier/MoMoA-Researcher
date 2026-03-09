---
name: "url-fetch-tool-string"
---
**URL Fetch Tool (${strings/tool-prefix}URL/FETCH)**
* **Purpose:** Retrieve content or download files from a specific URL.
* **Syntax:** ${strings/tool-prefix}URL/FETCH{Full URL to fetch. MUST include curly braces and the full URL (Eg. https://example.com/data.txt)}
* **Rules:**
  * **Prerequisite:** You must have a specific URL. If you need a file (like a dictionary or dataset) but do not know the URL, use the **Fact Finder** tool first to locate it.
  * Request *only one URL* at a time.
  * This tool automatically saves downloaded files (like datasets or binaries) to your project context.