// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import YAML from 'yaml';
import {z} from 'zod';

const actionSchema = z.object({
  type: z.enum(['profile', 'extract-business-workflows', 'run-tools', 'llm', 'write-reports']),
  promptId: z.string().optional(),
  runtime: z.string().optional()
});

const transitionSchema = z.object({
  on: z.string(),
  target: z.string(),
  guard: z.string().optional()
});

const stateSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  actions: z.array(actionSchema).default([]),
  transitions: z.array(transitionSchema).default([]),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional()
});

const playbookSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  initial: z.string(),
  states: z.array(stateSchema).min(1)
});

export type Playbook = z.infer<typeof playbookSchema>;

export function validatePlaybook(input: unknown): Playbook {
  const playbook = playbookSchema.parse(input);
  const stateIds = new Set(playbook.states.map((state) => state.id));
  if (!stateIds.has(playbook.initial)) {
    throw new Error(`Initial state "${playbook.initial}" is not declared.`);
  }
  for (const state of playbook.states) {
    for (const transition of state.transitions) {
      if (!stateIds.has(transition.target)) {
        throw new Error(`State "${state.id}" transitions to unknown state "${transition.target}".`);
      }
    }
  }
  return playbook;
}

export async function loadPlaybook(filePath: string): Promise<Playbook> {
  const raw = await readFile(filePath, 'utf8');
  return validatePlaybook(YAML.parse(raw));
}
