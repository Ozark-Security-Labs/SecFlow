import {runAudit} from '../core/auditEngine.js';
import {loadConfig} from '../core/config.js';

export interface AuditCommandOptions {
  cwd: string;
  target: string;
  approveContext?: boolean;
  runtime?: string;
}

export async function auditCommand(options: AuditCommandOptions): Promise<string> {
  const {config} = await loadConfig(options.cwd);
  const run = await runAudit({
    targetPath: options.target,
    config,
    contextApproved: options.approveContext,
    runtime: options.runtime
  });
  return [
    `SecFlow audit completed.`,
    `Run: ${run.runId}`,
    `Findings: ${run.findings.length}`,
    `Report: ${run.reportPath}`,
    `SARIF: ${run.sarifPath}`
  ].join('\n');
}
