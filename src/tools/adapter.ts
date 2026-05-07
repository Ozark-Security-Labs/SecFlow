// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {NormalizedFinding, ToolConfig, ToolRunResult} from '../core/types.js';
import {commandExists, runProcess} from '../util/process.js';
import {writeText} from '../util/files.js';

export interface ToolAdapter {
  name: string;
  defaultCommand: string;
  run(targetPath: string, runDir: string, config: ToolConfig): Promise<ToolRunResult>;
}

export async function runToolCommand(
  tool: string,
  targetPath: string,
  runDir: string,
  config: ToolConfig,
  args: string[],
  parseFindings: (stdout: string) => NormalizedFinding[]
): Promise<ToolRunResult> {
  const command = config.command;
  const available = await commandExists(command);
  const started = Date.now();
  const stdoutPath = path.join(runDir, 'raw', `${tool}.stdout.txt`);
  const stderrPath = path.join(runDir, 'raw', `${tool}.stderr.txt`);
  const rawJsonPath = path.join(runDir, 'raw', `${tool}.json`);

  if (!config.enabled) {
    return {
      tool,
      command,
      available,
      skipped: true,
      durationMs: 0,
      message: `${tool} is disabled in SecFlow config.`,
      findings: []
    };
  }

  if (!available) {
    return {
      tool,
      command,
      available: false,
      skipped: true,
      durationMs: Date.now() - started,
      message: `${tool} command "${command}" was not found on PATH.`,
      findings: []
    };
  }

  const result = await runProcess({
    command,
    args,
    cwd: targetPath,
    timeoutMs: config.timeoutMs,
    outputLimitBytes: config.outputLimitBytes
  });

  await writeText(stdoutPath, result.stdout);
  await writeText(stderrPath, result.stderr);
  if (looksLikeJson(result.stdout)) {
    await writeText(rawJsonPath, result.stdout);
  }

  const findings = result.exitCode === 0 || result.stdout ? parseFindings(result.stdout) : [];
  return {
    tool,
    command: result.commandLine,
    available: true,
    skipped: false,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutPath,
    stderrPath,
    rawJsonPath: looksLikeJson(result.stdout) ? rawJsonPath : undefined,
    message: result.timedOut ? `${tool} timed out.` : `${tool} completed with exit code ${result.exitCode}.`,
    findings
  };
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
