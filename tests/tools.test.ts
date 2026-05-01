import {describe, expect, it} from 'vitest';
import {normalizeSemgrepFindings} from '../src/tools/semgrep.js';
import {normalizeTrivyFindings} from '../src/tools/trivy.js';

describe('tool normalization', () => {
  it('normalizes Semgrep JSON output', () => {
    const findings = normalizeSemgrepFindings(
      JSON.stringify({
        results: [
          {
            check_id: 'javascript.express.security.audit',
            path: 'src/app.ts',
            start: {line: 10},
            extra: {
              message: 'Missing authorization check',
              severity: 'ERROR',
              metadata: {confidence: 'HIGH', cwe: ['CWE-862']}
            }
          }
        ]
      })
    );
    expect(findings[0]).toMatchObject({source: 'semgrep', path: 'src/app.ts', line: 10, confidence: 0.8});
  });

  it('normalizes Trivy vulnerability output', () => {
    const findings = normalizeTrivyFindings(
      JSON.stringify({
        Results: [
          {
            Target: 'package-lock.json',
            Vulnerabilities: [
              {
                VulnerabilityID: 'CVE-0000-0001',
                PkgName: 'demo',
                InstalledVersion: '1.0.0',
                FixedVersion: '1.0.1',
                Severity: 'HIGH',
                Title: 'Demo vulnerability'
              }
            ]
          }
        ]
      })
    );
    expect(findings[0]).toMatchObject({source: 'trivy', severity: 'high', path: 'package-lock.json'});
  });
});
