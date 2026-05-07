// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

describe('CODEOWNERS', () => {
  it('exists and covers core ownership areas', async () => {
    const codeowners = await readFile('.github/CODEOWNERS', 'utf8');
    expect(codeowners).toContain('* @bjcorder');
    expect(codeowners).toContain('/src/ @bjcorder');
    expect(codeowners).toContain('/prompts/ @bjcorder');
    expect(codeowners).toContain('/playbooks/ @bjcorder');
    expect(codeowners).toContain('/.github/ @bjcorder');
  });
});
