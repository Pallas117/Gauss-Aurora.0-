# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/8df1375b-9034-497c-8731-ec3cf4f902b4

## For non-coders: what is this?

**Project Gauss** is a Space Situational Awareness (SSA) platform: it shows live space weather (solar wind, radiation belts, magnetosphere) on a 3D globe and supports mission operations. For a code-free explanation, glossary, and how to run things, see **[docs/PROJECT_GAUSS_PLAIN_ENGLISH.md](docs/PROJECT_GAUSS_PLAIN_ENGLISH.md)**.

**One-command start** (frontend + backend + local chat stub):

```sh
npm i && npm run start
```

Then open the URL shown (e.g. http://localhost:8080). For first-time setup, copy `.env.example` to `.env` and run `npm run check:backend-env` if something fails.

### Alpha testers and 6GB (M1/M2/M3 8GB)

Project Gauss targets **Apple Silicon with 8GB unified memory** and enforces a **6GB effective limit** for mission simulations. Before running the full stack (frontend + backend + MLX/DeepSeek or Surya):

- **Close heavy apps** (Chrome with many tabs, other IDEs, Slack, etc.) to leave headroom.
- Prefer **stub mode** for the local chat engine (`npm run dev:stack` = stub on port 8089) if you are not testing the real DeepSeek model.
- For the real MLX model, use `npm start` (starts MLX with `--cache-limit-gb 2.5`). See `.env.example` and `docs/WIRING_AND_REDUNDANCIES.md`.

The full **Alpha Go/No-Go** verification list (memory audit, air-gap, Triad, UI, onboarding) is in **`docs/ALPHA_GO_NO_GO_CHECKLIST.md`**.

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/8df1375b-9034-497c-8731-ec3cf4f902b4) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/8df1375b-9034-497c-8731-ec3cf4f902b4) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Worktree Workflow

For branch-isolated development with Git worktrees, see:

- `docs/WORKTREE_ARCHITECTURE.md`

## CyberTiger Security Daemon

Security daemon and control mapping:

- `backend/cybertiger/daemon.ts`
- `docs/CYBERTIGER_COMPLIANCE_BASELINE.md`

Validation commands:

```sh
npm run check:backend-env
npm run check:security-compliance
```

## Release Workflow

Release guidance and commands:

- `docs/RELEASE_CHECKLIST.md`

```sh
npm run release:check
npm run release:tag -- vX.Y.Z
```

## Progress Checker CLI

The project includes a repo-aware milestone progress checker:

```sh
npm run progress
npm run progress:short
npm run progress:short:refresh
npm run progress:json
```

Run any command and print progress immediately after it:

```sh
npm run progress:after -- npm run test:fullstack
```

Update requirements-audit evidence used by V0.2 scoring:

```sh
npm run audit:adherence:record
```

Enable automatic progress output at each zsh prompt inside this repo:

```sh
npm run progress:hook:install
source ~/.zshrc
```

Optional controls:

```sh
export GAUSS_PROGRESS_ENABLED=0   # disable prompt output
export GAUSS_PROGRESS_INTERVAL=20 # seconds between auto checks
```

## Workspace Layout (Coding First)

Use the workspace map and focused tree view:

- `docs/WORKSPACE_MAP.md`
- `bash scripts/process/workspace-tree.sh`

Canonical tool paths (no spaces):

- `gauss-orchestrator/`
- `tools/progress-checker/`
- `research/`

Legacy compatibility symlinks were removed in strict cleanup.

## Secure Connectivity Agent

For mobile/public network development with approval-gated network changes:

```sh
npm run network:secure
npm run network:secure:apply
npm run network:secure:watch
```

Detailed policy and satellite fallback options:

- `docs/NETWORK_CONNECTIVITY_STRATEGY.md`
