// SPDX-License-Identifier: AGPL-3.0-only
import {runAudit} from '../core/auditEngine.js';
import {loadConfig} from '../core/config.js';

export interface AuditCommandOptions {
  cwd: string;
  target: string;
  approveContext?: boolean;
  approveRemediationDrafts?: boolean;
  runtime?: string;
}

export async function auditCommand(options: AuditCommandOptions): Promise<string> {
  const {config} = await loadConfig(options.cwd);
  const run = await runAudit({
    targetPath: options.target,
    config,
    contextApproved: options.approveContext,
    remediationDraftApproved: options.approveRemediationDrafts,
    runtime: options.runtime
  });
  return [
    `SecFlow audit completed.`,
    `Run: ${run.runId}`,
    `Case: ${run.caseId ?? run.runId}`,
    `Findings: ${run.findings.length}`,
    `Patch drafts: ${run.remediationDrafts?.length ?? 0}`,
    `Report: ${run.reportPath}`,
    `JSON: ${run.jsonReportPath ?? 'not written'}`,
    `SARIF: ${run.sarifPath}`
  ].join('\n');
}
