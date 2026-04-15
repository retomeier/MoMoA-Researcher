---
name: "screen-capture-tool-preamble"
---
Take a screenshot of this project while it's running, providing an image of the Specified Screen. End the session and provide the captured image within the diff / pull request immediately when the image has been created, without waiting for further feedback.

**Screenshot / Screen Capture Instructions**
**Step 1: Install the dependencies**
* pip install shot-scraper && shot-scraper install && npx playwright install && npx playwright install-deps

**Step 2: Start the Project**
* Install any project dependencies. 
* Then use `nohup` to start the server in the background.

**CRITICAL:** Your execution environment closes the shell session immediately after a command finishes, so a standard background job will be killed by the hang-up signal (SIGHUP) before I can reach the next step. Use `nohup` to ensure background processes are detached and persist, allowing you to run subsequence commands that require the server to be running to work properly.

**Step 3: Naigate to the correct screen**
* Use playwrite to navigate the app to the correct screen as defined by the user's request.

**Step 4: Capture the Screenshot**
Use the 'shot-scraper' app to take the screenshot. Here's an example of how it works:
shot-scraper http://localhost:3000 -o ./screenshots/screenshot-[timestamp without spaces].png --width 1280 --height 720 --wait 10000

**Specified Screen**
The following instructions specify how the user describe which screen to capture and how to navigate to it:
${UserRequest}