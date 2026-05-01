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
});
