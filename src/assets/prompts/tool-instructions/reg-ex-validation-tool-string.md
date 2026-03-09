---
name: "reg-ex-validation-tool-string"
---
**RegEx Validation Tool (${strings/tool-prefix}REGEX/VALIDATE)**
* **Purpose:** To build, test, and debug regular expressions before integrating them into source code. Use this tool whenever you are creating or modifying a regular expression.
* **Syntax:**
${strings/tool-prefix}REGEX/VALIDATE{
  "regExString": "{SoRegEx}<raw_regex_pattern>{EoRegEx}",
  "flags": "<optional_flags>",
  "testCases": [
    { "type": "validate", "input": "<input1>", "expected": <true_or_false> },
    { "type": "extract", "input": "<input2>", "expected": "<extracted_string>", "group": 1 }
  ]
}
* **Rules and Usage:**
  * **Core Principle: Isolate and Test the Smallest Part**
    * **Think in Units:** Treat RegEx validation like unit testing. When modifying a regular expression that is built from multiple parts in the code, you MUST identify and test **only the specific component you are changing.**
    * **DO NOT Reconstruct Complex Patterns:** Avoid recreating large, multi-part regular expressions from the source code. This is error-prone and leads to overly complex tests. Your goal is to verify your specific change, not to re-implement the entire RegEx logic within the tool.
    * **Example:** If the code is `final_regex = part_A + part_B` and you only need to modify `part_A`, your test should focus exclusively on `part_A`.
  * **CRITICAL: RegEx Delimiters:** To prevent parsing errors, the value of the `regExString` field **MUST** be wrapped in the `{SoRegEx...EoRegEx}` delimiters. The tool is designed to handle this specific format.
    * **`regExString` (string):** The Regular Expression pattern string to be tested, wrapped with the required delimiters. Do *not* escape any part of this, this should be the raw regex string to be evaluated.
    * **`flags` (string, optional):** Flags for the RegEx engine (e.g., "i" for case-insensitive, "g" for global). Defaults to an empty string.
    * **`testCases` (array):** An array of test case objects. Each object defines a single test and must contain:
      * `type`: The type of test. Must be one of the following:
        * `validate`: Returns `true` if the pattern is found, `false` otherwise.
        * `extract`: Extracts a string using capture groups.
        * `replace`: Replaces matched text with a new string.
        * `findAll`: Finds all non-overlapping matches.
        * `split`: Splits the input string using the regex as a delimiter.
      * `input`: The string input for the test case.
      * `expected`: The expected outcome. The data type depends on the `type` (e.g., boolean for `validate`, string for `extract`, array for `findAll`).
      * `group` (number, optional): For `type: 'extract'`, the capture group index. Defaults to `0` (the full match).
      * `replacement` (string, optional): For `type: 'replace'`, the string to replace matched patterns with.
  * **Return Value:** The tool returns a JSON object with `isRegexValid`, a `summary` of test results, and a `testResults` array detailing the outcome of each individual test case.