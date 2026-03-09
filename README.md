# Mixture of Mixture of Agents - Researcher

Coordinate multiple AI agents to iteratively investigate complex research questions by proposing hypotheses, executing local Python or Rust experiments, evaluating outcomes, and generating academic reports.

----

MoMoA (Mixture of Mixture of Agents) Researcher is a full-stack application. The primary workflow involves defining a research objective in the React frontend, which pushes task definitions to a Firebase Realtime Database. A Node.js server listens for these queues, cloning required repositories into memory and spinning up specialized agent roles to run experiments.

It is an extension / adaptation of the [Mixture of Mixture of Agents SDLC Agent](https://labs.google/code/experiments/momoa).

The `DashboardPage.tsx` shows how a research session is started from the User Interface.
The `ResearchProjectPage.tsx` shows how session updates are displayed to the user, and implements the continuous research loop.

----

This system builds on the Experts, Work Phases, and Tools of the MoMoA Agent. It adds a "Senior Researcher", "Research Room", and Research Tools to conduct experiments using the scientific method.

## Research Tools

To prevent agents from wasting time inventing identical tooling, MoMoA Researcher provides specific tools that operate within the agent's virtual machine.

* **The Optimizer**: Evaluates Python or Rust functions concurrently to explore large mathematical search spaces.
  * *Usage*: Finds theoretical maximums across discrete grids or random float/integer distributions.
  * *Constraints*: Limited to a maximum of 200 total runs (5 concurrent) within a 10-minute timeout to control compute costs.

* **Code Runner**: Executes pure Python or Rust scripts using a restricted set of pre-installed libraries within the Research Agent's VM.
  * *Constraints*: Limited to a 10-minute timeout to control compute costs.

* **Research Logger**: An append-only logging mechanism to track experimental results across Work Phases and research sessions.
  * *Usage*: Enforces strict scientific tracking. Agents must record hypotheses, experimental data, and analysis here before modifying overarching reports.

## UI & Orchestration Features

The React frontend enables project and task initiation, visualizes the agent's work, and facilitates human oversight.

* **Research Projects**: A hierarchical workspace where an overarching goal (e.g., "Find the longest Collatz sequence") contains multiple individual research sessions/tasks.
* **Interrogation Chat**: A chat interface that persists the full context of previous tasks, modified files, and session logs, allowing you to question the agent about its methodologies during or after a run.
* **Self-Evaluation & Continuous Loop**: After a task, the agent grades its own performance and proposes the next logical experiments. Toggling "Auto-run top suggestion" will execute these sequentially without human intervention.

## Setup & Configuration

This project is built using a Node.js backend (`tsx`, `express`) and a React/Vite frontend. It relies heavily on Firebase Realtime Database for state synchronization between the client and the orchestrator.

**1. Clone and Install Dependencies**
The project uses `concurrently` to run both web and server environments.

```bash
npm install
```

**2. Configure Firebase**

This project uses Firebase to store details on each project and session. To use the UI, you will need to create your own Firebase project and provide your own client and server-side configuration details.

**2.1. Create a Firebase Project**

* Go to the [Firebase Console](https://console.firebase.google.com/).
* Click **Add project** and follow the on-screen instructions.

**2.2. Register a Web App**

* In your new Firebase project dashboard, click the **Web** icon (`</>`) to add a new web app.
* Give your app a nickname and click **Register app**.

**2.3. Get Your Client Configuration**

* After registering, Firebase will provide you with a Firebase Config object containing your API keys and identifiers. This should be placed in the `web/src/firebase-config.ts` file:

**2.4. Generate the Service Account Key (Admin SDK)**
Now create server-side administrative access:
* In the Firebase Console, click the gear icon next to **Project Overview** in the top left and select **Project settings**.
* Navigate to the **Service accounts** tab.
* Click the **Generate new private key** button at the bottom, then click **Generate key** to confirm.
* A JSON file containing your service account credentials will securely download to your machine.

**2.5. Add the Service Account File**
* Rename the downloaded JSON file to `.firebase-service-account.json`.
* Move this file into the root directory of your local project repository.
* **Security Warning:** Never commit this file to version control. It grants full administrative control over your Firebase project database and auth.

**2.6. Link the Firebase CLI (Optional but required for deploying/functions)**
If you need to deploy Firebase Functions, Security Rules, or Hosting, you must link your local environment to your Firebase project using the Firebase CLI.
* If you don't have the CLI installed, install it by running: `npm install -g firebase-tools`
* Log in to the Firebase CLI:
```bash
firebase login
```
* Link this local directory to your Firebase project:
```bash
firebase use --add
```
* When prompted, select the Firebase project you created in Step 1 and type `default` as the alias. This will automatically generate a `.firebaserc` file for you.

**3. Run the application**
Start the frontend and backend simultaneously:

```bash
npm run dev
```

This triggers both `npm run dev:web` (Vite on standard port) and `npm run dev:server` (Node server on port 3007).

## Limitations
Be aware that the current orchestration is designed such that the Service, Code Runner, and Optimier all run within the same VM. If you are doing heavy algorithmic optimization, the compute bottleneck is significant. Scaled deployments would require modifying the Optimizer and Code Runner to spin up parallelized infrastructure.

## About this Project

Project Home Page:
https://labs.google/code/experiments/momoa-reaearcher

Code Home:
https://github.com/retomeier/momoa

Maintained by:
Reto Meier

## License
This project is licensed under the Apache 2 License - see the [license.md](LICENSE) file for details.