import type {NormalizedFinding} from '../core/types.js';
import type {ToolAdapter} from './adapter.js';
import {runToolCommand} from './adapter.js';

export const trivyAdapter: ToolAdapter = {
  name: 'trivy',
  defaultCommand: 'trivy',
  run(targetPath, runDir, config) {
    const args = config.args ?? ['fs', '--format', 'json', targetPath];
    return runToolCommand('trivy', targetPath, runDir, config, args, normalizeTrivyFindings);
  }
};

export function normalizeTrivyFindings(stdout: string): NormalizedFinding[] {
  const parsed = parseJson(stdout);
  const findings: NormalizedFinding[] = [];
  const results = Array.isArray(parsed?.Results) ? parsed.Results : [];

  for (const result of results) {
    const target = String(result.Target ?? '');
    for (const vulnerability of result.Vulnerabilities ?? []) {
      findings.push({
        id: `trivy:${vulnerability.VulnerabilityID}:${target}:${vulnerability.PkgName ?? ''}`,
        source: 'trivy',
        title: `${vulnerability.VulnerabilityID}: ${vulnerability.Title ?? vulnerability.PkgName ?? 'Dependency vulnerability'}`,
        severity: mapSeverity(vulnerability.Severity),
        confidence: 0.75,
        path: target,
        description: vulnerability.Description ?? 'Trivy reported a dependency or package vulnerability.',
        evidence: [`Package: ${vulnerability.PkgName ?? 'unknown'}`, `Installed: ${vulnerability.InstalledVersion ?? 'unknown'}`],
        recommendation: vulnerability.FixedVersion ? `Upgrade to ${vulnerability.FixedVersion} or later.` : 'Review advisory guidance and compensating controls.',
        references: Array.isArray(vulnerability.References) ? vulnerability.References.map(String) : undefined,
        metadata: vulnerability
      });
    }

    for (const misconfiguration of result.Misconfigurations ?? []) {
      findings.push({
        id: `trivy:${misconfiguration.ID}:${target}`,
        source: 'trivy',
        title: `${misconfiguration.ID}: ${misconfiguration.Title ?? 'Misconfiguration'}`,
        severity: mapSeverity(misconfiguration.Severity),
        confidence: 0.7,
        path: target,
        description: misconfiguration.Description ?? 'Trivy reported a misconfiguration.',
        evidence: [misconfiguration.Message, misconfiguration.CauseMetadata?.Resource].filter(Boolean).map(String),
        recommendation: misconfiguration.Resolution ?? 'Review and harden the affected configuration.',
        references: misconfiguration.PrimaryURL ? [String(misconfiguration.PrimaryURL)] : undefined,
        metadata: misconfiguration
      });
    }
  }

  return findings;
}

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function mapSeverity(value: unknown): NormalizedFinding['severity'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'low';
  return 'info';
}
