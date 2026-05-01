import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import {defaultConfig} from '../src/core/defaults.js';
import {runAudit} from '../src/core/auditEngine.js';

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
});
