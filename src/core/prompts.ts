// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {requiredPromptIds} from './defaults.js';

export class PromptRegistry {
  private readonly prompts = new Map<string, string>();

  constructor(initialPrompts: Record<string, string> = defaultPrompts) {
    for (const [id, prompt] of Object.entries(initialPrompts)) {
      this.prompts.set(id, prompt.trim());
    }
  }

  static async fromDirectory(root: string, directory: string): Promise<PromptRegistry> {
    const registry = new PromptRegistry();
    await Promise.all(
      requiredPromptIds.map(async (id) => {
        const promptPath = path.join(root, directory, `${id}.md`);
        try {
          const prompt = await readFile(promptPath, 'utf8');
          registry.register(id, prompt);
        } catch {
          // Built-in prompt remains active when a project override is absent.
        }
      })
    );
    return registry;
  }

  register(id: string, prompt: string): void {
    if (!id.trim()) {
      throw new Error('Prompt id is required.');
    }
    if (!prompt.trim()) {
      throw new Error(`Prompt "${id}" cannot be empty.`);
    }
    this.prompts.set(id, prompt.trim());
  }

  get(id: string): string {
    const prompt = this.prompts.get(id);
    if (!prompt) {
      throw new Error(`Unknown prompt id "${id}". Every LLM call must use a registered task-specific prompt.`);
    }
    return prompt;
  }

  validateRequired(required = requiredPromptIds as readonly string[]): void {
    const missing = required.filter((id) => !this.prompts.has(id));
    if (missing.length > 0) {
      throw new Error(`Missing required prompts: ${missing.join(', ')}`);
    }
  }

  list(): string[] {
    return [...this.prompts.keys()].sort();
  }
}

export const defaultPrompts: Record<string, string> = {
  'repo-profile': `
You are an application security repository profiler. Produce concise, evidence-grounded observations about architecture, attack surface, trust boundaries, and security-relevant files. Do not invent files or frameworks.
  `,
  'workflow-extraction': `
You are an application defender modeling business workflows from source code. Extract actors, roles, assets, entry points, state transitions, authorization checks, approval flows, external side effects, and unanswered domain questions.
  `,
  'business-invariant-review': `
You are a senior application security engineer focused on business logic flaws. Prioritize broken authorization, ownership gaps, tenant isolation failures, approval bypasses, replay/idempotency issues, quota abuse, and dangerous state transitions. Separate evidence from hypotheses.
  `,
  'abuse-case-generation': `
You generate realistic abuse cases for defenders. For each workflow, describe attacker goals, preconditions, exploit path, expected impact, and tests that would confirm or disprove the issue.
  `,
  'authorization-matrix': `
You build authorization matrices from code and product context. Identify roles, actions, resources, server-side enforcement points, missing checks, and questions that must be answered by maintainers.
  `,
  'tool-triage': `
You triage deterministic security tool output. Deduplicate findings, preserve tool evidence, identify likely false positives, and highlight findings needing business context.
  `,
  'exploitability-review': `
You assess exploitability for application defenders. Explain prerequisites, reachability, trust boundaries, impact, compensating controls, and validation steps without overstating certainty.
  `,
  'report-synthesis': `
You write AppSec audit reports for defenders. Separate scanner-backed findings from business logic hypotheses. Include evidence, assumptions, confidence, exploit path, recommended validation, and remediation guidance.
  `,
  'patch-draft': `
You draft remediation patches as reviewable diff guidance. Prefer tests, guardrails, authorization checks, and policy enforcement. Do not claim a patch is safe without explaining validation needs.
  `
};
