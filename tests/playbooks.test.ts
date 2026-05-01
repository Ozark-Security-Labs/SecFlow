import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import YAML from 'yaml';
import {validatePlaybook} from '../src/core/playbooks.js';

describe('playbooks', () => {
  it('validates the default audit playbook', async () => {
    const raw = await readFile('playbooks/default-audit.yaml', 'utf8');
    const playbook = validatePlaybook(YAML.parse(raw));
    expect(playbook.initial).toBe('initialize');
    expect(playbook.states.some((state) => state.id === 'llm-review')).toBe(true);
  });

  it('rejects transitions to unknown states', () => {
    expect(() =>
      validatePlaybook({
        name: 'bad',
        version: 1,
        initial: 'a',
        states: [{id: 'a', transitions: [{on: 'success', target: 'missing'}]}]
      })
    ).toThrow(/unknown state/);
  });
});
