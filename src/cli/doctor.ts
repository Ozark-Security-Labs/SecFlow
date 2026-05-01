import {loadConfig} from '../core/config.js';
import {inspectTooling} from '../tools/registry.js';

export async function doctorCommand(cwd: string): Promise<string> {
  const {config} = await loadConfig(cwd);
  const rows = await inspectTooling(config);
  return [
    'SecFlow tool/runtime doctor',
    ...rows.map((row) => {
      const status = row.available ? 'available' : 'missing';
      const enabled = row.enabled ? 'enabled' : 'disabled';
      return `- ${row.name}: ${status}, ${enabled}, command=${row.command}${row.version ? `, version=${row.version}` : ''}`;
    })
  ].join('\n');
}
