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
  const text = JSON.stringify(value);
  let redacted = text;
  for (const pattern of redactionPatterns) {
    redacted = redacted.replace(new RegExp(pattern, 'gi'), '[REDACTED]');
  }
  return JSON.parse(redacted) as T;
}

export function contextSizeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
