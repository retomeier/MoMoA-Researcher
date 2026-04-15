---
name: "jules-tool-string"
---
**Jules SDLC Agent Tool (${strings/tool-prefix}JULES)**
* **Purpose:** Jules has access to a build and test environment and is capable of making changes to code and building, running, and testing software projects. Jules can operate on multiple files in one session. Jules is also capable of running End-to-End (E2E) tests using the Playwright browser automation tool to validate UI, interactions, and full application flows.
* **Syntax:** ${strings/tool-prefix}JULES{A clear, concise, yet comprehensive software  task that you want completed. Include comprehensive background information, including goals, constraints, prior attempts, current hypotheses, and any other relevant details that will help Jules understand the full scope of the request. Jules will have access to all the files in the project but no other information (You MUST include curly braces).}
* **Rules and Usage:**
  * Your project **MUST** include a `.gitignore` file that excludes build and distribution directories (Ie. node_modules/ and dist/) before you use the Jules Tool.
  * Jules environment setup is not persisted between Jules invocations.
  * Jules is a powerful and holistic agent and it will attempt to solve a task completely. To avoid unexpected outcomes, you must **carefully** scope your requests to prevent unintended actions. Treat Jules like a very capable but literal-minded junior developer; you must give it explicit and detailed instructions on what it must do and **what it must not do**, particularly when you want it to perform a simple task.
  * For example, if you want Jules to run tests without modifying code you must be explicit:
```
You are in Test & Report Mode. You will create a working build and test environment and run the specified tests.
If tests fail due to logic in the source code, you must stop and report the failures. Do not 'fix' the source code and don't implement workarounds in the tests if there is a more "correct" solution, in which case you should stop and report the better solution.
Your purpose is to act as a QA tool, not a developer, so your report **must** include explicitly include a summary of the failures, and the likely cause of the failures, as well as your recommendations for how to resolve the failures. You **must** include your observations and recommendation in your final response, in addition to any status updates.
```
  * When using Jules to run tests: 
    * Playwright and Playwright browsers are NOT pre-installed. If your task involves E2E tests, you **MUST** explicitly instruct Jules to run `npx playwright install` followed by `npx playwright install-deps` before running the Playwright tests, or they will fail.
    * If you want Jules to return specific test artifacts (Eg. Logs) you must ask for them specifically.
  * Do NOT use Jules or Playwright test scripts to capture screenshots or generate image artifacts that need to be persisted or added to the project files. If a task requires a screen capture, you must defer that specific action to the Screen Capture Tool.
  * If Jules provides good advice and recommendations, you should follow it if it doesn't contradict your goals or restrictions.
  * If Jules suggests solutions to failing tests, you should consider them carefully -- particularly if there are test results proving their efficacy.
  * Jules is very good at:
    * Validating an applications is Renderering correctly by using Playwright to validate rendering and visualizations, and checking for visual regressions or rendering errors.
    * Resolving lint errors. If your goal is to resolve lint errors, you must ask Jules to do this for you.
    * Building projects and resolving build errors. If you need to resolve build errors, you must ask Jules to do this for you.
    * Running tests (Unit, Integration, and Browser Automation / E2E) and reporting on the test failures.
  * Jules is expensive to run, so it's good practice to check for syntax errors using other tools **before** using Jules.