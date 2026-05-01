import {describe, expect, it} from 'vitest';
import {renderSarif} from '../src/core/reports.js';
import type {NormalizedFinding} from '../src/core/types.js';

describe('reports', () => {
  it('renders SARIF for normalized findings', () => {
    const finding: NormalizedFinding = {
      id: 'business-logic:test',
      source: 'business-logic',
      title: 'Approval bypass',
      severity: 'high',
      confidence: 0.7,
      path: 'src/routes.ts',
      line: 42,
      description: 'Approval transition may be bypassed.',
      evidence: ['src/routes.ts'],
      recommendation: 'Add authorization and approval tests.'
    };
    const sarif = renderSarif([finding]) as any;
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0].level).toBe('error');
  });
});
