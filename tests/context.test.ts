// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import {redactContext} from '../src/core/context.js';
import {defaultConfig} from '../src/core/defaults.js';

describe('context redaction', () => {
  it('redacts source snippets without corrupting JSON-shaped context', () => {
    const context = {
      fileSamples: [
        {
          path: 'fixtures/auth.py',
          content: 'JWT_SECRET = "PLACEHOLDER_SECRET_DO_NOT_USE"\nheaders = {"authorization": "bearer test-token"}'
        }
      ]
    };

    const redacted = redactContext(context, defaultConfig.context.redactions);

    expect(redacted.fileSamples[0]?.content).toContain('[REDACTED]');
    expect(JSON.parse(JSON.stringify(redacted))).toEqual(redacted);
  });

  it('preserves arrays and object fields while redacting nested strings', () => {
    const redacted = redactContext({metadata: {token: 'safe key name'}, evidence: ['api_key = "abc123"']}, defaultConfig.context.redactions);

    expect(redacted.metadata.token).toBe('safe key name');
    expect(redacted.evidence[0]).toContain('[REDACTED]');
  });
});
