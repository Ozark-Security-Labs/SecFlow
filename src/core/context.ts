// SPDX-License-Identifier: AGPL-3.0-only
import type {BusinessWorkflowModel, NormalizedFinding, RepoProfile} from './types.js';

export interface ContextPackage {
  profile: RepoProfile;
  business: BusinessWorkflowModel;
  findings: NormalizedFinding[];
  generatedAt: string;
}

export function buildContextPackage(profile: RepoProfile, business: BusinessWorkflowModel, findings: NormalizedFinding[]): ContextPackage {
  return {
    profile,
    business,
    findings,
    generatedAt: new Date().toISOString()
  };
}

export function redactContext<T>(value: T, redactionPatterns: string[]): T {
  const patterns = redactionPatterns.map((pattern) => new RegExp(pattern, 'gi'));
  return redactValue(value, patterns) as T;
}

export function contextSizeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function redactValue(value: unknown, patterns: RegExp[]): unknown {
  if (typeof value === 'string') {
    return patterns.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, patterns));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, patterns)]));
  }
  return value;
}
