---
name: "file-search-tool-string"
---
**File Search Tool (${strings/tool-prefix}FILESEARCH)**
* **Purpose:** Search for filenames, file paths (directories), and plain-text content *within* files.
* **Syntax:** ${strings/tool-prefix}FILESEARCH{query: "Your search string" END_QUERY}
* **Rules and Usage:**
  1. **DO NOT ESCAPE CHARACTERS.** The query is a **LITERAL** string. The tool does **NOT** process escape characters (like `\"`). It will search for the backslash itself.
     * **WRONG:** `${strings/tool-prefix}FILESEARCH{query: "dataProvider = \"DataProvider\"" END_QUERY}`
       *(This will fail by searching for the literal characters `\` and `"`)*
     * **RIGHT:** `${strings/tool-prefix}FILESEARCH{query: "dataProvider = "DataProvider"" END_QUERY}`
       *(This will correctly search for the string `dataProvider = "DataProvider"`)*
  2. **PLAIN TEXT & CASE-SENSITIVE.** The search is a **case-sensitive**, plain-text **substring** match.
     * It is **NOT** a full-word match. A search for `"Test"` will find `"Test"`, `"Testing"`, and `"MyTest"`.
     * It **IS** case-sensitive. A search for `"Test"` will **NOT** find `"test"`.
  3. **NO REGEX, WILDCARDS, or OPERATORS.** The tool does **NOT** support regular expressions, wildcards, or logical operators (`AND`, `OR`).
     * **WRONG:** `${strings/tool-prefix}FILESEARCH{query: "createData\(" END_QUERY}` (This is regex)
     * **WRONG:** `${strings/tool-prefix}FILESEARCH{query: "*.java" END_QUERY}` (This is a wildcard)
     * **RIGHT:** `${strings/tool-prefix}FILESEARCH{query: ".java" END_QUERY}` (This will find any file *content* or *filename* containing the literal substring `.java`)
* **Additional Usage Notes:**
  * **Syntax:** The `END_QUERY}` marker is mandatory and must immediately follow the closing quote of your query string.
  * **Single Query:** Request *only one search* at a time. Wait for the response before requesting another.
  * **Results:** Returns a list of full file paths that contain the search text in their content *or* in their filename/path.