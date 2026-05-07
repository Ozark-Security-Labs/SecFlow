// SPDX-License-Identifier: AGPL-3.0-only
import {loadConfig} from '../core/config.js';
import {listRuntimeSummaries} from '../llm/runtimeRegistry.js';

export async function modelsCommand(cwd: string): Promise<string> {
  const {config} = await loadConfig(cwd);
  const rows = listRuntimeSummaries(config);
  return [
    'SecFlow LLM runtimes',
    ...rows.map((row) => `- ${row.name}: ${row.kind}, ${row.enabled ? 'enabled' : 'disabled'}, model=${row.model ?? 'default'}, auth=${row.auth ?? 'n/a'}`)
  ].join('\n');
}
