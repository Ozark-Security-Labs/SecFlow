# SecFlow

SecFlow is an LLM harness designed for application security engineers and application defenders.

It profiles application repositories, runs registered deterministic security tools, performs business logic analysis, and produces local audit artifacts for review.

## V1 Capabilities

- TypeScript ESM application with an Ink/React terminal UI.
- Headless `secflow audit` command for local and CI-style runs.
- First-class business logic analysis focused on actors, roles, assets, state transitions, authorization checks, tenant boundaries, approval flows, replay/idempotency, and other abuse paths.
- Registered deterministic tool adapters for Semgrep, Trivy, and Joern.
- LLM runtime adapters for OpenAI, Anthropic, OpenRouter, Codex CLI, and Claude Code CLI.
- Task-specific prompt registry that rejects unregistered prompt ids.
- Local run artifacts under `.secflow/runs/<timestamp>/`, including JSON, Markdown, SARIF, and raw tool output.
- GitHub CODEOWNERS metadata for ongoing ownership hygiene.

## Quick Start

```bash
npm install
npm run build
npm run dev -- init
npm run dev -- audit .
```

By default, LLM runtimes are disabled and scanner tools are detected from your local `PATH`. Enable runtimes in `.secflow/config.yaml` and pass `--approve-context` when you want a curated, redacted context package sent to a configured provider or local agent CLI.

## Commands

```bash
secflow
secflow init
secflow audit <path> [--approve-context] [--runtime name]
secflow tools doctor
secflow playbooks validate [path]
secflow models list
```

## Security Posture

SecFlow detects but does not install Semgrep, Trivy, Joern, Codex CLI, or Claude Code CLI. Tool execution is limited to registered adapters with explicit commands, timeouts, output caps, and run logs. Patch output is generated as reviewable artifacts only; V1 does not directly edit audited source repositories.
