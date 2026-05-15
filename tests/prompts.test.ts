// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import {PromptRegistry} from '../src/core/prompts.js';

describe('PromptRegistry', () => {
  it('contains all required default prompts', () => {
    const registry = new PromptRegistry();
    expect(() => registry.validateRequired()).not.toThrow();
    expect(registry.list()).toContain('business-invariant-review');
  });

  it('rejects unknown prompt ids', () => {
    const registry = new PromptRegistry();
    expect(() => registry.get('generic-security-helper')).toThrow(/Unknown prompt id/);
  });

  it('gives workflow extraction evidence and output-format instructions', () => {
    const registry = new PromptRegistry();
    const prompt = registry.get('workflow-extraction');
    expect(prompt).toContain('normalized SecFlow finding');
    expect(prompt).toContain('Evidence entries must cite repository paths');
    expect(prompt).toContain('Return only JSON matching the provided schema');
  });
});
