import type {SecFlowConfig, ToolRunResult} from '../core/types.js';
import {joernAdapter} from './joern.js';
import {semgrepAdapter} from './semgrep.js';
import {trivyAdapter} from './trivy.js';
import {commandExists, commandVersion} from '../util/process.js';

export const builtInToolAdapters = [semgrepAdapter, trivyAdapter, joernAdapter];

export async function runConfiguredTools(
  targetPath: string,
  runDir: string,
  config: SecFlowConfig,
  onToolComplete?: (result: ToolRunResult) => void
): Promise<ToolRunResult[]> {
  const results: ToolRunResult[] = [];
  for (const adapter of builtInToolAdapters) {
    const toolConfig = config.tools[adapter.name];
    if (!toolConfig) {
      continue;
    }
    const result = await adapter.run(targetPath, runDir, toolConfig);
    results.push(result);
    onToolComplete?.(result);
  }
  return results;
}

export async function inspectTooling(config: SecFlowConfig): Promise<Array<{name: string; command: string; enabled: boolean; available: boolean; version?: string}>> {
  const rows = [];
  for (const adapter of builtInToolAdapters) {
    const toolConfig = config.tools[adapter.name];
    const command = toolConfig?.command ?? adapter.defaultCommand;
    const available = await commandExists(command);
    rows.push({
      name: adapter.name,
      command,
      enabled: Boolean(toolConfig?.enabled),
      available,
      version: available ? await commandVersion(command) : undefined
    });
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.kind !== 'codex-cli' && provider.kind !== 'claude-code-cli') {
      continue;
    }
    const command = provider.command ?? (provider.kind === 'codex-cli' ? 'codex' : 'claude');
    const available = await commandExists(command);
    rows.push({
      name,
      command,
      enabled: provider.enabled,
      available,
      version: available ? await commandVersion(command) : undefined
    });
  }

  return rows;
}
