import path from 'node:path';
import {loadPlaybook} from '../core/playbooks.js';

export async function validatePlaybookCommand(cwd: string, playbookPath: string): Promise<string> {
  const absolutePath = path.resolve(cwd, playbookPath);
  const playbook = await loadPlaybook(absolutePath);
  return `Playbook "${playbook.name}" is valid with ${playbook.states.length} states.`;
}
