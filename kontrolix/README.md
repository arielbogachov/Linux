# Kontrolix

A small, Jenkins-style automation server for pipelines that span **Docker** and **Kubernetes** — build an image, push it, convert a Compose file to K8s manifests, and deploy — all as one job, with a web dashboard, a CLI, run history, and three trigger types (manual, cron, webhook).

## Features

- **Pipeline steps**: `dockerBuild`, `dockerPush`, `composeConvert` (Compose → K8s YAML), `k8sDeploy`, `optimize`, `shell`
- **Triggers**: manual (click Run), cron schedule, or webhook (`POST /webhook/:jobName`)
- **Persistence**: SQLite-backed job definitions, run history, and step-by-step logs
- **Web dashboard**: create pipelines, watch live logs, browse run history, one-click optimize
- **CLI**: script the same server from your terminal
- **⚡ One-click optimize**: paste a Kubernetes manifest, `docker-compose.yml`, or `Dockerfile` and get back a hardened version — resource requests/limits, liveness/readiness probes or healthchecks, non-root/read-only security context, and (for Dockerfiles) a slimmer base image + `HEALTHCHECK`. You always see a diff before anything is applied.

## Requirements

- Node.js 22.13+ (uses the built-in `node:sqlite` module — no native compiler needed)
- Docker daemon running locally (for `dockerBuild` / `dockerPush` steps) — the server talks to it via the Docker socket, same as the `docker` CLI
- A kubeconfig at `~/.kube/config` (or in-cluster config) for `k8sDeploy` steps

## Setup

```bash
npm install
npm start
```

The dashboard runs at **http://localhost:8080**.

## Using the CLI

The CLI talks to the running server over HTTP (set `KONTROLIX_URL` if it's not on localhost:8080).

```bash
# Link the CLI (optional, for a global `kontrolix` command)
npm link

# Create a job from a JSON definition
kontrolix create examples/build-deploy.json

# List jobs
kontrolix list

# Trigger a run
kontrolix run build-and-deploy-web

# Follow logs live
kontrolix logs <runId> --follow

# List recent runs
kontrolix runs

# One-click optimize (preview only)
kontrolix optimize k8s/web-deployment.yaml --type k8s

# Optimize and save the result locally
kontrolix optimize docker-compose.yml --type compose --out docker-compose.optimized.yml

# Optimize and write the result on the server (./optimized-output/)
kontrolix optimize Dockerfile --type dockerfile --apply
```

## Job definition format

```json
{
  "name": "build-and-deploy-web",
  "description": "Build, push, convert, deploy",
  "trigger_type": "webhook",           // "manual" | "cron" | "webhook"
  "trigger_config": { "secret": "change-me" },  // or { "schedule": "*/15 * * * *" } for cron
  "steps": [
    { "type": "dockerBuild", "context": ".", "dockerfile": "Dockerfile", "tag": "myapp/web:latest" },
    { "type": "dockerPush", "tag": "myapp/web:latest" },
    { "type": "composeConvert", "composeFile": "docker-compose.yml", "outputDir": "./k8s" },
    { "type": "k8sDeploy", "namespace": "staging" }
  ]
}
```

Steps run in order; later steps can rely on earlier ones (e.g. `k8sDeploy` will use the manifests written by a preceding `composeConvert` step automatically if `manifestDir`/`manifestPath` is omitted).

## One-click optimize

Available from the dashboard's **⚡ Optimize** tab, the CLI (`kontrolix optimize`), and as a pipeline step (`{ "type": "optimize", "target": "k8s" | "compose" | "dockerfile", "inputPath": "...", "outputPath": "..." }`).

What it changes, by file type:

| Target | Auto-applied | Only suggested (needs manual judgment) |
|---|---|---|
| Kubernetes YAML | resource requests/limits · liveness/readiness HTTP probes (if a port is defined) · securityContext hardening (non-root, read-only rootfs, no priv escalation, drop all capabilities) | — |
| docker-compose.yml | `deploy.resources` limits/reservations · healthcheck (if a port is exposed) · `no-new-privileges`, `cap_drop: [ALL]`, `read_only`, non-root `user` | — |
| Dockerfile | swap final-stage base image for a slimmer variant (e.g. `node:20` → `node:20-alpine`) · add a non-root `USER` · add `HEALTHCHECK` (if `EXPOSE` is present) | splitting into a multi-stage build, when build tooling is detected in a single-stage Dockerfile |

The API preview endpoint (`POST /api/optimize`) always returns the change list, any suggestions, and a line-level diff before anything is written — nothing is applied until you explicitly click **Apply** (UI), run with `--apply` (CLI), or call `POST /api/optimize/apply`.

## Triggering via webhook

Point your git host's webhook (or `curl`) at:

```
POST http://your-server:8080/webhook/<job-name>?secret=<secret>
```

## Project layout

```
server.js              Express entry point
src/db.js               SQLite schema + connection (node:sqlite)
src/scheduler.js        node-cron wiring for cron-triggered jobs
src/routes/api.js       REST API: jobs, runs, logs
src/routes/webhook.js   Webhook trigger endpoint
src/routes/optimize.js  Optimize API: preview (diff) + apply
src/optimize/*.js       Optimizer rules — one module per file type (k8s, compose, dockerfile)
src/jobs/executor.js    Runs a job's steps in order, streams logs to SQLite
src/jobs/steps/*.js     One module per pipeline step type
bin/cli.js              CLI (kontrolix ...)
public/                 Dashboard (vanilla HTML/CSS/JS, no build step)
examples/                Example job JSON for the CLI
```

## Notes

- This was built to run against a **real** Docker daemon and Kubernetes cluster — the step modules use `dockerode` and `@kubernetes/client-node`, the same libraries production tooling uses. There's no simulation layer, so nothing will execute successfully until it can reach an actual Docker socket / kubeconfig.
- The Compose→K8s converter covers the common subset (image, ports, environment, command, `deploy.replicas`) — not every Compose feature. For a full-fidelity conversion, `kompose convert` is a good complement.
