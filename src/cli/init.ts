import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {writeDefaultConfig} from '../core/config.js';
import {defaultPrompts} from '../core/prompts.js';
import {ensureDir} from '../util/files.js';

export async function initProject(cwd: string): Promise<string[]> {
  const written: string[] = [];
  written.push(await writeDefaultConfig(cwd));

  const promptsDir = path.join(cwd, 'prompts');
  await ensureDir(promptsDir);
  for (const [id, prompt] of Object.entries(defaultPrompts)) {
    const promptPath = path.join(promptsDir, `${id}.md`);
    await writeFile(promptPath, `${prompt.trim()}\n`, {flag: 'wx'}).then(
      () => written.push(promptPath),
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    );
  }

  const playbooksDir = path.join(cwd, 'playbooks');
  await mkdir(playbooksDir, {recursive: true});
  const playbookPath = path.join(playbooksDir, 'default-audit.yaml');
  await writeFile(playbookPath, defaultPlaybookYaml, {flag: 'wx'}).then(
    () => written.push(playbookPath),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  );

  return written;
}

export const defaultPlaybookYaml = `name: default-audit
version: 1
initial: initialize
states:
  - id: initialize
    description: Prepare a local SecFlow audit run.
    actions:
      - type: profile
    transitions:
      - on: success
        target: business-workflows
  - id: business-workflows
    description: Extract business workflows, actors, assets, state transitions, and invariants.
    actions:
      - type: extract-business-workflows
        promptId: workflow-extraction
    transitions:
      - on: success
        target: deterministic-tools
  - id: deterministic-tools
    description: Run registered deterministic security tools.
    actions:
      - type: run-tools
    transitions:
      - on: success
        target: llm-review
  - id: llm-review
    description: Synthesize scanner findings and business logic hypotheses through the configured runtime.
    actions:
      - type: llm
        promptId: report-synthesis
    transitions:
      - on: success
        target: reports
      - on: skipped
        target: reports
  - id: reports
    description: Write Markdown, JSON, and SARIF artifacts.
    actions:
      - type: write-reports
    transitions: []
`;
