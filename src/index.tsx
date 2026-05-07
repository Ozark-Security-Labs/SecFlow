#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import {Command} from 'commander';
import {auditCommand} from './cli/audit.js';
import {doctorCommand} from './cli/doctor.js';
import {initProject} from './cli/init.js';
import {modelsCommand} from './cli/models.js';
import {validatePlaybookCommand} from './cli/playbooks.js';
import {renderFullscreenTui} from './tui/render.js';

const program = new Command();

program
  .name('secflow')
  .description('LLM harness for application security engineers and application defenders')
  .version('0.1.0')
  .action(async () => {
    await renderFullscreenTui(process.cwd());
  });

program
  .command('init')
  .description('Create SecFlow config, prompt, and playbook scaffolding')
  .action(async () => {
    const written = await initProject(process.cwd());
    console.log(['SecFlow initialized.', ...written.map((file) => `- ${file}`)].join('\n'));
  });

program
  .command('audit')
  .argument('[target]', 'Target repository path', '.')
  .option('--approve-context', 'Approve sending the curated context package to the configured LLM runtime')
  .option('--runtime <name>', 'Override configured runtime for this run')
  .description('Run a SecFlow audit and write local artifacts')
  .action(async (target: string, options: {approveContext?: boolean; runtime?: string}) => {
    console.log(await auditCommand({cwd: process.cwd(), target, approveContext: options.approveContext, runtime: options.runtime}));
  });

const tools = program.command('tools').description('Inspect deterministic security tool integrations');
tools
  .command('doctor')
  .description('Check registered tools and local CLI runtime availability')
  .action(async () => {
    console.log(await doctorCommand(process.cwd()));
  });

const playbooks = program.command('playbooks').description('Validate and inspect SecFlow playbooks');
playbooks
  .command('validate')
  .argument('[path]', 'Playbook path', 'playbooks/default-audit.yaml')
  .description('Validate a YAML playbook')
  .action(async (playbookPath: string) => {
    console.log(await validatePlaybookCommand(process.cwd(), playbookPath));
  });

const models = program.command('models').description('Inspect LLM runtimes and model profiles');
models
  .command('list')
  .description('List configured LLM runtimes')
  .action(async () => {
    console.log(await modelsCommand(process.cwd()));
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
