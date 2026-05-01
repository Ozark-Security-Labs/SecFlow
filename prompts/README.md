# SecFlow Prompts

SecFlow requires every LLM or local agent call to reference a task-specific prompt id.
Project-specific prompt overrides can be created with `secflow init`; built-in defaults are embedded in `src/core/prompts.ts`.

Required prompt ids:

- `repo-profile`
- `workflow-extraction`
- `business-invariant-review`
- `abuse-case-generation`
- `authorization-matrix`
- `tool-triage`
- `exploitability-review`
- `report-synthesis`
- `patch-draft`
