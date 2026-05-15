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
You are an application defender performing business-logic workflow extraction from source code.

Your job is to turn repository evidence into a structured workflow model that SecFlow can use beside deterministic scanner findings. Treat this as analysis for a defender who needs reviewable hypotheses, evidence paths, validation steps, and remediation direction. Do not write prose outside the requested JSON shape.

Inputs you will receive:
- Repository profile: manifests, likely frameworks, notable directories, and security-relevant files.
- Heuristic workflow model: locally detected actors, roles, assets, entry points, state transitions, permissions, approval flows, side effects, review questions, and initial risks.
- File samples: source excerpts from security-relevant files. These excerpts are the primary evidence source.

Analysis requirements:
- Identify concrete business workflows, not just security keywords.
- Prefer server-side entry points, handlers, controllers, routes, jobs, webhooks, authorization policies, domain services, and state mutation functions.
- Distinguish production code from fixtures, tests, examples, generated output, and documentation. If evidence appears fixture-only, say so in the risk hypothesis or assumptions.
- Extract actors as product participants such as users, admins, owners, tenants, service accounts, anonymous callers, operators, or third-party systems.
- Extract roles and permission concepts only when supported by code evidence such as claims, scopes, RBAC checks, policies, guards, ownership checks, tenant checks, or authorization helpers.
- Extract assets that can be created, viewed, changed, transferred, exported, revoked, deleted, paid for, approved, or otherwise abused.
- Extract entry points with enough specificity to be useful, for example "POST /api/invoices/:id/approve", "approveInvoice handler", "webhook receiver", or "background refund job" when the evidence supports it.
- Extract state transitions such as approve, reject, activate, deactivate, cancel, refund, transfer, publish, delete, archive, restore, verify, rotate, revoke, reset, export, or invite.
- Extract permission checks and guardrails as named functions, policies, route middleware, claim checks, tenant filters, ownership checks, idempotency checks, replay protections, approval controls, and audit logging.
- Extract external side effects such as payment charges, refunds, emails, SMS, webhook delivery, queue publishing, file export, token issuance, credential reset, notification dispatch, or third-party API calls.

Risk requirements:
- Produce business-logic risks only when there is evidence or a clearly stated gap in evidence.
- Keep every risk suitable for conversion into a normalized SecFlow finding.
- Every risk title must be concise and action-oriented.
- Severity must reflect potential business impact and confidence in the static evidence, not scanner severity.
- Confidence must be 0.0 to 1.0 and should be lower when the evidence is heuristic, fixture-only, or missing domain context.
- The hypothesis must describe the suspected business-logic failure in defender terms.
- Evidence entries must cite repository paths and, when possible, line numbers or symbol names. Use strings that can stand beside scanner evidence in reports.
- Assumptions must explicitly state what is not proven by the sampled code.
- Exploit path must describe a plausible abuse flow in one or two sentences.
- Validation steps must be concrete checks a maintainer can perform, such as adding abuse-case tests, tracing server-side authorization, verifying tenant filters, or exercising replay/idempotency behavior.
- Recommendation must be a concise remediation direction that can be shown next to scanner recommendations.

Output requirements:
- Return only JSON matching the provided schema.
- Do not include markdown, commentary, code fences, or extra keys.
- Use empty arrays when there is no evidence for a category.
- Preserve exact file paths from the input samples.
- Do not invent routes, roles, assets, or enforcement points not supported by the provided context.
- If the repository appears to be a scanner, library, framework, or test corpus rather than an application, explicitly reflect that in reviewQuestions, risk assumptions, and risk confidence.
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
