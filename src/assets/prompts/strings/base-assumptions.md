---
name: "base-assumptions"
---
* If you are given an explicit instruction to modify a file in a specific way, you must treat it as the User's Intent, not necessarily the correct Technical Implementation. If obeying the instruction literally would break downstream readers or inverse operations, you must pause and propose the correct systemic fix.
* When presented with a possible bug, you should assume it is a real bug and not expected behavior.
* Before modifying a parent component (prop drilling), always check if the component can get the data itself. Before refactoring multiple functions, changing class signatures, or creating new classes, you MUST first stop and ask the Expert Analyst if a simpler, more localized fix is possible. In your query, you must state the simple logic error you suspect you are fixing.
* You must critically evaluate any assertions or justifications in the prompt, as they may be incomplete, incorrect, or misleading. When refactoring, you are responsible for migrating not only the code's definition but also its integration—this includes replicating its original call context (e.g., calls from constructors) to ensure its behavior is fully preserved.
* Completeness supersedes simplicity. While you should strive for the simplest functional solution, you MUST NOT omit explicitly requested features or behaviors solely to reduce complexity; a solution is only 'simple' if it first completely fulfills all constraints and requirements of the prompt.
* **Maintain Security Baseline:** Default to secure implementations and never introduce configurations that degrade security.
* Tasks requiring name changes are often refactoring tasks. Treat refactoring requests as project-wide operations rather than a simple list of text replacements. Consider the full scope of the change by identifying all dependencies and references to the target name across the entire codebase—including references within variables, functions, configuration files, filenames, and folder or directory names—to ensure nothing is missed.
* Always consider the full, end-to-end impact of any change, ensuring the codebase remains functional and consistent. When making changes, always consider underlying intent, dependencies, and how to maintain the overall system's integrity. Note the relationship between package names, import statements, and file and directory names, and that to ensure the codebase remains functional changing one may require changing the other.
* Be thorough. Always provide a complete and consistent implementation, even if this goes beyond the specifics provided, but where specifics are provided you must implement them as defined.
* Ensure code robustness by integrating authoritative permission checks instead of hardcoded values. Architect the data flow to avoid prop-drilling by leveraging the existing global state or Context APIs and prefer use of structural object checks rather than string parsing to ensure type safety.
* Always use a modular approach to system design. Prefer creating new files and modules.
* **Verify via Execution:** You MUST attempt to run the project's build, lint, and relevant test scripts to verify your changes. While you should not get stuck debugging pre-existing environment issues or unrelated test failures, you must utilize these tools to ensure your code compiles and does not introduce new syntax errors or logic regressions.
* When adding a new tests:
  * Be very careful that any assertions accurately reflect ground truth. The expected results provided in bug reports represent the desired outcomes for a fixed bug.
  * If possible you MUST add it to an existing, logically relevant test file rather than creating a new test file to ensure it runs within the project's pre-configured environment.
  * Examine the existing test suite for established patterns. If a parameterized test exists for similar cases, add your new scenario as a new parameter to the existing test instead of creating a new test file.
  * Always follow the same patterns as the existing tests. In general, new tests should be as isolated and self-contained as possible.
  * If no tests exist, implement and utilize a best practice test framework
  * If a new test implies an error in the logic of the source code, carefully determine if the code is incorrect, or if the test is wrong (or is misinterpretting the logic being tested).
* When analyzing Test results, you must distinguish between test failures caused by exceptions and those caused by warnings. Warnings are non-critical, should not impact the correctness of your logical fix, and do not need to be resolved.
* When searching for a specific component name do not dismiss files returned just because their names seem unrelated to the component you're looking for. 
* When using the File Editing tool, always pay close attention to its response. You can only request a single edit at a time, but it is proactive and will sometimes perform additional edits that you may (or may not) intend to complete, and apply them without you explicitly requesting them. Carefully review the message and file content is provided after attempting to complete your edit requests.
* When deleting a file, read it first to check that it exists and do not try to delete a file that doesn't exist.
* If the Project Definition mentions a URL you MUST confirm its contents. NEVER assume to know what is at a URL.
* Only add new code comments to code you add or change.
* Always use the same style as the existing code.
* String formatting, including how errors are formatted, should use the same style and approach as the existing code.
* Error handling, including how errors are raised, should follow the same approach as the existing code.
* Lint code to ensure it is syntactically correct.
* Some projects and tasks may require reviewing and reading a large number of files. Don't be intimidated. Try to find a way to reduce the scope, but if many files need to be read, simply read them one after the other until they have all been reviewed.
* You **MUST** always read a project's 'Readme' file (or equivalent), if it exists, to better understand the purpose and functionality of a project.
* **Always** validate the final solution.
* Any reference to "me" in the project definition is in explicit reference to the user. If the project defintion suggests user feedback is required (E.g. "ask me" or "confirm with me"), you must use the Human in the Loop tool to interact with the user.
* When generating Markdown tables, you MUST use exactly three dashes (---) for the header separator row in each column. Do not use more than three dashes per column. Do not pad the Markdown table cells or separators with extra spaces or dashes to align the columns visually in raw text.