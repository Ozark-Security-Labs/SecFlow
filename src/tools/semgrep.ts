import type {NormalizedFinding} from '../core/types.js';
import type {ToolAdapter} from './adapter.js';
import {runToolCommand} from './adapter.js';

export const semgrepAdapter: ToolAdapter = {
  name: 'semgrep',
  defaultCommand: 'semgrep',
  run(targetPath, runDir, config) {
    const args = config.args ?? ['scan', '--config', 'auto', '--json', targetPath];
    return runToolCommand('semgrep', targetPath, runDir, config, args, normalizeSemgrepFindings);
  }
};

export function normalizeSemgrepFindings(stdout: string): NormalizedFinding[] {
  const parsed = parseJson(stdout);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  return results.map((result: Record<string, any>, index: number) => {
    const metadata = result.extra?.metadata ?? {};
    const cwe = Array.isArray(metadata.cwe) ? metadata.cwe.map(String) : metadata.cwe ? [String(metadata.cwe)] : undefined;
    return {
      id: `semgrep:${result.check_id ?? index}:${result.path ?? 'unknown'}:${result.start?.line ?? 0}`,
      source: 'semgrep',
      title: String(result.extra?.message ?? result.check_id ?? 'Semgrep finding'),
      severity: mapSeverity(result.extra?.severity ?? metadata.impact ?? metadata.confidence),
      confidence: mapConfidence(metadata.confidence),
      path: result.path,
      line: result.start?.line,
      description: String(result.extra?.message ?? 'Semgrep reported a source-code issue.'),
      evidence: [result.extra?.lines, result.path].filter(Boolean).map(String),
      recommendation: 'Review the Semgrep rule guidance and validate reachability in the application workflow.',
      cwe,
      references: Array.isArray(metadata.references) ? metadata.references.map(String) : undefined,
      metadata
    } satisfies NormalizedFinding;
  });
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
  if (normalized.includes('critical')) return 'critical';
  if (normalized.includes('high')) return 'high';
  if (normalized.includes('medium') || normalized.includes('warning')) return 'medium';
  if (normalized.includes('low')) return 'low';
  return 'info';
}

function mapConfidence(value: unknown): number {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('high')) return 0.8;
  if (normalized.includes('medium')) return 0.6;
  if (normalized.includes('low')) return 0.4;
  return 0.5;
}
