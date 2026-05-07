// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import {defaultConfig} from '../src/core/defaults.js';
import {runAudit} from '../src/core/auditEngine.js';
import type {AuditEvent} from '../src/core/types.js';

describe('audit engine', () => {
  it('produces a local report without scanners or LLM runtimes', async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), 'secflow-audit-'));
    await writeFile(
      path.join(targetPath, 'routes.ts'),
      `
        export function approveInvoice(req) {
          sendEmail(req.body.email);
          return { ok: true };
        }
      `,
      'utf8'
    );
    const config = {
      ...defaultConfig,
      tools: {
        semgrep: {...defaultConfig.tools.semgrep!, command: 'definitely-missing-semgrep'},
        trivy: {...defaultConfig.tools.trivy!, command: 'definitely-missing-trivy'},
        joern: {...defaultConfig.tools.joern!, command: 'definitely-missing-joern'}
      }
    };
    const run = await runAudit({targetPath, config, contextApproved: false});
    expect(run.findings.length).toBeGreaterThan(0);
    expect(run.toolResults.every((result) => result.skipped)).toBe(true);
    expect(await readFile(run.reportPath, 'utf8')).toContain('Business Logic Analysis');
    expect(await readFile(run.sarifPath, 'utf8')).toContain('SecFlow');
  });

  it('emits audit events in order for a local-only run', async () => {
    const targetPath = await createTarget();
    const events: AuditEvent[] = [];
    const run = await runAudit({targetPath, config: missingToolConfig(), contextApproved: false, onEvent: (event) => events.push(event)});

    expect(run.findings.length).toBeGreaterThan(0);
    expect(events.map((event) => event.type)).toContain('run:complete');
    expect(events.find((event) => event.type === 'llm:skipped' && event.reason === 'No default runtime configured.')).toBeTruthy();
    expect(stepStarts(events)).toEqual(['initialize', 'profile', 'business-workflows', 'tools', 'reports']);
  });

  it('emits context preview and skips LLM when approval is denied', async () => {
    const targetPath = await createTarget();
    const events: AuditEvent[] = [];
    const config = {
      ...missingToolConfig(),
      defaultRuntime: 'openai',
      providers: {
        ...defaultConfig.providers,
        openai: {...defaultConfig.providers.openai!, enabled: true}
      }
    };

    const run = await runAudit({
      targetPath,
      config,
      approveContext: () => false,
      onEvent: (event) => events.push(event)
    });

    expect(run.llmResponses).toHaveLength(0);
    expect(events.some((event) => event.type === 'context:preview')).toBe(true);
    expect(events.find((event) => event.type === 'llm:skipped' && event.reason.includes('approval'))).toBeTruthy();
  });
});

async function createTarget(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), 'secflow-audit-'));
  await writeFile(
    path.join(targetPath, 'routes.ts'),
    `
      export function approveInvoice(req) {
        sendEmail(req.body.email);
        return { ok: true };
      }
    `,
    'utf8'
  );
  return targetPath;
}

function missingToolConfig() {
  return {
    ...defaultConfig,
    tools: {
      semgrep: {...defaultConfig.tools.semgrep!, command: 'definitely-missing-semgrep'},
      trivy: {...defaultConfig.tools.trivy!, command: 'definitely-missing-trivy'},
      joern: {...defaultConfig.tools.joern!, command: 'definitely-missing-joern'}
    }
  };
}

function stepStarts(events: AuditEvent[]): string[] {
  return events.filter((event) => event.type === 'step:start').map((event) => event.step);
}
