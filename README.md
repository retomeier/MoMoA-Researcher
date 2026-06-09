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

* After registering, Firebase will provide you with a Firebase Config object containing your API keys and identifiers. This should be placed in the `src/firebase-config.ts` file:

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


## Decoupling computation from the server's host environment

By default, the Code Runner and Optimizer tools will run within the same execution environment as the server. The UI enables the user to select an alternative "Execution Environment" in which these tools will be executed.

You can learn more about why and how this is done from the [AgentBridge Article](https://labs.google/code/experiments/agentbridge).

### Server's Host Environment

The default setting, the tools will execute within the same environment as the server, with files staged in a temporary folder. No further setup is required.

### E2B.dev

The user must provide a valid E2B.dev API Key. Navigage to the [E2B.dev Dashboard](https://e2b.dev/dashboard) and copy the API Key from there.

At the time of writing, new E2B accounts automatically receive a one-time free credit on their Hobby tier, with sessions limited to 1 hour and concurrency at 20 sandboxes. Using the E2B provider will eventually use all these credits and the account will eventually require a usage-based Pro plan with billing added.

### Cloud Run Jobs

The other Execution Providers use the user's credentials and API keys to let them 'bring their own' compute resources at runtime. The Cloud Run Jobs Execution Provider uses resources from a dedicated Firebase / Google Cloud project—by default the same service the project is deployed to.

Cloud Run Jobs are ephemeral, non-interactive execution environments that the Execution Provider communicates with via a worker script that is executed within the Job's container and a Google Cloud Storage container. 

#### Prerequisites
You will need a Google Cloud Project with the following services enabled. This can be the same project to which you've deployed the service:
* Cloud Run API
* Cloud Build API
* Cloud Storage API
* Artifact Registry API
* Firebase Storage

#### Confirm Firebase / Cloud Settings
The Cloud Run Job provider leverages your existing Firebase configuration (defined in `/src/firebase-config.ts`) to orchestrate the code execution. Even if you're not deploying your service to Firebase, make sure this file includes the `projectId` for a Cloud Project with the required APIs enabled and a storage bucket that will be used to transfer files.

```typescript
export const FIREBASE_CONFIG = {
  projectId: "myProjectId",
  storageBucket: "myProjectId.firebasestorage.app",
  // [ Remaining file]
};
```

#### Deploy the Cloud Run Job
Ensure you have the Google Cloud CLI (`gcloud`) installed and authenticated for the Google Cloud project you're using.

> In the example, we've hard-coded all our services to run in `us-central1`. If you change this, you must update it within the Execution Provider and deployment scripts.

For simplicity, this project uses the same Dockerfile for the containers used for both hosting the service and for the Cloud Run Jobs execution environments. To deploy the Cloud Run Job worker image, run the `/scripts/deploy.sh` deployment script from the project root:

```bash
# Make sure the script is executable
chmod +x deploy/deploy.sh

# Run the deployment script
./scripts/deploy.sh
```

**What this script does:**
1. Builds the main `Dockerfile` (containing Node, Python, and Rust runtimes).
2. Pushes the image to Google Container Registry/Artifact Registry.
3. Creates or updates a Cloud Run Job named `momoa-code-runner` in `us-central1` (matching the hardcoded expectations of the provider).
4. Overrides the container's startup command to run the execution worker instead of the main API server.

#### Granting Permissions to start new Cloud Run Jobs

If you are running MoMoA locally use the Google Cloud CLI to login and use your credentials:
```bash 
gcloud auth application-default login
```

If you deploy MoMoA to Google Cloud Run, you must grant the Service Account it runs with explicit permissions:

**Required IAM Roles:**
*   **Cloud Run Invoker** (`roles/run.invoker`): Allows the main application to programmatically start the `momoa-code-runner` job via the Cloud Run API.
*   **Storage Object Admin** (`roles/storage.objectAdmin`): Allows the application to upload code payloads and download execution results from your Firebase Storage bucket.

### Cloud Workstations

The [Google Cloud CLI tools must be installed](https://docs.cloud.google.com/sdk/docs/install-sdk), initialized, and authorized on the server's host environment.

By default, the UI uses Firebase Auth to prompt the user to allow authorization scope for access to their Google Cloud projects. If available, the Cloud Workstation Provider creates an isolated, temporary configuration for that user's project.

An alternative code path exists (but has been commented out) that allows the Execution Provder to 'fall back' to the default `gcloud` credentials configured on the server host environment. This is useful if you're running the server locally, or if you aren't able to enable the Cloud scopes.

In either case, the user **must** specify the following in the UI:
* A GCP Project ID, that includes the specified:
* Cloud Workstation name.

The tools will stage files in a temporary folder within the Cloud Workstation before execution and cleanup.

### Cloud Shell Editor

The Cloud Shell Editor provider uses a nearly identical architecture to the Workstations provider, but routes the execution to the user's Google Cloud Shell environment.

The [Google Cloud CLI tools must be installed](https://docs.cloud.google.com/sdk/docs/install-sdk), initialized, and authorized on the server's host environment.

By default, the UI uses Firebase Auth to prompt the user to allow authorization scope for access to their Google Cloud projects. If available, the Cloud Shell Provider creates an isolated, temporary `gcloud` configuration for that user's specific access token. If a token is not provided, it falls back to the host machine's default credentials.

To use this provider, the user **must** specify the following in the UI:
* A **GCP Project ID**

The tools will stage files in a temporary folder within the Cloud Workstation before execution and cleanup.

### Remote Desktop

The Remote Desktop provider allows the MoMoA orchestrator to dispatch execution tasks directly to a dedicated local compute server. This local agent polls the server for pending tasks, executes them in a temporary sandbox, and uploads the results back to the Orchestrator. By running locally, the agent can leverage your host hardware, scaling concurrent tasks based on your available CPU cores.

#### Prerequisites
To initialize the local compute server, you must configure the following environment variables:
*   **`AGENT_ID` (Required):** A unique identifier for your local compute server. This value must exactly match the `remoteDesktopKey` secret provided by the client UI context to ensure tasks are routed correctly.
*   **`SERVER_URL` (Optional):** The URL of your MoMoA backend server. If omitted, it defaults to `http://localhost:3007`.
*   **`GEMINI_API_KEY` (Conditionally Required):** Required if your workflows utilize the local fact-finder script (`local_fact_finder.js`) to parse and read local documents.

#### Starting the Local Compute Server
The agent is launched via the command line using the `localComputeCLI.mjs` script, which is located in the `local-compute-cli` directory. You must pass the path to a local documents folder as a command-line argument, which grants the agent's fact-finder tool access to local files for research tasks.

```bash
# 1. Navigate to the CLI directory
cd local-compute-cli

# 2. Run the agent, passing your environment variables and the path to your docs
GEMINI_API_KEY="your_actual_api_key_here" AGENT_ID="your_secure_agent_id" SERVER_URL="http://localhost:3007" node localComputeCLI.mjs ./your-docs-folder
```

### Adding Support for Jules and Stitch Tools
To enable MoMoA to use the [Stitch](https://stitch.withgoogle.com) and [Jules](https://jules.google.com/) Tools you must sign-up for Jules and / or Stitch, obtain API keys:
* `JULES_API_KEY` can be obtained from Jules following [these instructions](https://developers.google.com/jules/api).
* `STITCH_API_KEY` can be obtained from the Stitch [settings page](https://stitch.withgoogle.com/settings).

The Jules API doesn't currently support repo-less tasks, so you must also provide a GitHub access token that has access to a GitHub repository that is connected to Jules, and in which we can create a temporary branch that the Jules Tool will use to provide access to Jules:
* `GITHUB_TOKEN` can be obtained from [GitHub Developer Settings](https://github.com/settings/tokens).
* `GITHUB_SCRATCHPAD_REPO` (Eg. `myusername/my-private-jules-scratchpad-repo`).

## About this Project

Project Home Page:
[https://labs.google/code/experiments/momoa-researcher](https://labs.google/code/experiments/momoa-researcher)

Code Home:
[https://github.com/retomeier/MoMoA-Researcher](https://github.com/retomeier/MoMoA-Researcher)

Maintained by:
Reto Meier

## License
This project is licensed under the Apache 2 License - see the [license.md](LICENSE) file for details.
