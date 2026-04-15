---
name: "screen-capture-tool-string"
---
**Screen Capture Tool (${strings/tool-prefix}SCREENSHOT)**
* **Purpose:** Use the Screen Capture Tool to take a high-fidelity screenshot of the current project. The tool handles installing necessary dependencies, starting the server in the background, navigating to the required page, capturing the visual output, and returning a screenshot / screen capture file you can read. You **must** use this tool to take screen shots or screen captures rather than  creating a new script or relying on the output of test scripts.
* **Syntax:** ${strings/tool-prefix}SCREENSHOT{Clear description of the specific screen you want captured and the steps required to navigate there.}
* **Rules and Usage:**
  * **Automatic Setup:** The tool will automatically execute dependency installation. You do not need to instruct it to install these manually.
  * **Background Server Execution:** The tool will start the project in the background in a non-blocking way to allow for screen capture.
  * **Navigation & Capture:** The tool will navigate to the correct screen based on your instructions. Your request must include specific navigation instructions (e.g., specific URLs, interactions, or login steps) so the tool knows exactly how to reach the intended screen.
* **Example:**
  * *Bad:* `${strings/tool-prefix}SCREENSHOT{Take a screenshot.}`
  * *Good:* `${strings/tool-prefix}SCREENSHOT{Start the application, navigate to http://localhost:3000/settings, click on the 'Profile' tab, wait for the user data to load, and capture the screen.}`