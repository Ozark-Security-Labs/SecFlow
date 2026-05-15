// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import YAML from 'yaml';

const requiredFields = ['id', 'title', 'phase', 'status', 'dependencies', 'owner', 'files_allowed', 'acceptance', 'verify_commands', 'blockers', 'notes'];
const allowedStatuses = ['pending', 'in_progress', 'blocked', 'review', 'complete'];

describe('implementation ledger', () => {
  it('contains the narrowed MVP scope and required task fields', async () => {
    const raw = await readFile('.until-done/tasks.yaml', 'utf8');
    const ledger = YAML.parse(raw) as any;

    expect(raw).not.toMatch(/draft PR|GitHub issue|SARIF upload|SQLite|extensions/i);
    expect(ledger.goal).toContain('local-first Ink TUI audit cockpit');
    expect(ledger.tasks.filter((task: any) => task.status === 'in_progress').length).toBeLessThanOrEqual(1);
    expect(ledger.finalGate.status).toBe('complete');

    for (const task of ledger.tasks) {
      for (const field of requiredFields) {
        expect(task).toHaveProperty(field);
      }
      expect(allowedStatuses).toContain(task.status);
      expect(task.verify_commands.length).toBeGreaterThan(0);
    }
  });
});
