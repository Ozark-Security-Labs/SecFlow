// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {SecFlowConfig} from '../core/types.js';
import {loadConfig} from '../core/config.js';
import {listRuntimeSummaries} from '../llm/runtimeRegistry.js';
import {inspectTooling} from '../tools/registry.js';

export type ToolingStatus = Awaited<ReturnType<typeof inspectTooling>>[number];
export type RuntimeSummary = ReturnType<typeof listRuntimeSummaries>[number];

export interface PreflightData {
  targetPath: string;
  config: SecFlowConfig;
  configPath?: string;
  tooling: ToolingStatus[];
  runtimes: RuntimeSummary[];
  defaultRuntime?: string;
  warnings: string[];
}

export async function loadPreflightData(cwd: string, targetPath: string): Promise<PreflightData> {
  const absoluteTarget = path.resolve(cwd, targetPath);
  const {config, path: configPath} = await loadConfig(cwd);
  const tooling = await inspectTooling(config);
  const runtimes = listRuntimeSummaries(config);
  const warnings: string[] = [];

  const missingEnabledTools = tooling.filter((row) => row.enabled && !row.available && ['semgrep', 'trivy', 'joern'].includes(row.name));
  if (missingEnabledTools.length > 0) {
    warnings.push(`Missing enabled scanners: ${missingEnabledTools.map((row) => row.name).join(', ')}`);
  }
  if (!config.defaultRuntime) {
    warnings.push('No default LLM runtime is configured; audit will run local-only.');
  }
  if (config.context.requireApproval) {
    warnings.push('LLM context approval is required before runtime invocation.');
  }

  return {
    targetPath: absoluteTarget,
    config,
    configPath,
    tooling,
    runtimes,
    defaultRuntime: config.defaultRuntime,
    warnings
  };
}
