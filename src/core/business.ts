// SPDX-License-Identifier: AGPL-3.0-only
import type {BusinessRisk, BusinessWorkflowModel, RepoProfile, Severity} from './types.js';
import {readSmallTextFile} from './profile.js';

const signalDefinitions = [
  {kind: 'actors', pattern: /\b(user|customer|member|admin|owner|manager|operator|service account|anonymous)\b/gi},
  {kind: 'roles', pattern: /\b(role|roles|rbac|permission|permissions|scope|scopes|claim|claims)\b/gi},
  {kind: 'assets', pattern: /\b(account|tenant|organization|invoice|payment|subscription|order|profile|document|file|token|secret|api key)\b/gi},
  {kind: 'trustBoundaries', pattern: /\b(webhook|callback|external|third[- ]party|public api|upload|sso|oauth|saml)\b/gi},
  {kind: 'entryPoints', pattern: /\b(route|router|controller|handler|endpoint|mutation|query|webhook|middleware)\b/gi},
  {kind: 'stateTransitions', pattern: /\b(approve|reject|activate|deactivate|cancel|refund|transfer|publish|delete|archive|restore|verify)\b/gi},
  {kind: 'permissionChecks', pattern: /\b(authorize|isAuthorized|can\w+|requireRole|hasPermission|ownerId|tenantId|policy)\b/gi},
  {kind: 'moneyOrDataMovement', pattern: /\b(payment|refund|invoice|payout|transfer|download|share|email|sms|notification)\b|export(?:data|csv|report|file|users|orders)/gi},
  {kind: 'approvalFlows', pattern: /\b(approval|approvedBy|review|reviewer|moderation|four eyes|dual control)\b/gi},
  {kind: 'externalSideEffects', pattern: /\b(send|publish|enqueue|emit|post|put|delete|charge|refund|webhook|queue)\b/gi}
] as const;

type SignalKind = (typeof signalDefinitions)[number]['kind'];

export async function extractBusinessWorkflowModel(targetPath: string, profile: RepoProfile): Promise<BusinessWorkflowModel> {
  const buckets: Record<SignalKind, Set<string>> = {
    actors: new Set(),
    roles: new Set(),
    assets: new Set(),
    trustBoundaries: new Set(),
    entryPoints: new Set(),
    stateTransitions: new Set(),
    permissionChecks: new Set(),
    moneyOrDataMovement: new Set(),
    approvalFlows: new Set(),
    externalSideEffects: new Set()
  };

  const evidenceByKind = new Map<SignalKind, string[]>();
  const candidateFiles = [...new Set([...profile.securityRelevantFiles, ...profile.sampledFiles.map((sample) => sample.path)])].slice(0, 80);

  for (const relativePath of candidateFiles) {
    const content = await readSmallTextFile(targetPath, relativePath).catch(() => undefined);
    const haystack = `${relativePath}\n${content ?? ''}`;
    for (const definition of signalDefinitions) {
      const matches = [...haystack.matchAll(definition.pattern)].map((match) => match[0].toLowerCase());
      for (const match of matches.slice(0, 8)) {
        buckets[definition.kind].add(match);
      }
      if (matches.length > 0) {
        const evidence = evidenceByKind.get(definition.kind) ?? [];
        evidence.push(relativePath);
        evidenceByKind.set(definition.kind, evidence);
      }
    }
  }

  const risks = buildBusinessRisks(buckets, evidenceByKind);

  return {
    generatedAt: new Date().toISOString(),
    actors: sortedValues(buckets.actors),
    roles: sortedValues(buckets.roles),
    assets: sortedValues(buckets.assets),
    trustBoundaries: sortedValues(buckets.trustBoundaries),
    entryPoints: sortedValues(buckets.entryPoints),
    stateTransitions: sortedValues(buckets.stateTransitions),
    permissionChecks: sortedValues(buckets.permissionChecks),
    moneyOrDataMovement: sortedValues(buckets.moneyOrDataMovement),
    approvalFlows: sortedValues(buckets.approvalFlows),
    externalSideEffects: sortedValues(buckets.externalSideEffects),
    reviewQuestions: buildReviewQuestions(buckets),
    risks
  };
}

function buildBusinessRisks(buckets: Record<SignalKind, Set<string>>, evidenceByKind: Map<SignalKind, string[]>): BusinessRisk[] {
  const risks: BusinessRisk[] = [];

  if (buckets.entryPoints.size > 0 && buckets.permissionChecks.size === 0) {
    risks.push(risk('Entry points without obvious authorization checks', 'high', 'Request handlers were detected, but no obvious authorization or ownership checks were found.', ['entryPoints'], evidenceByKind));
  }

  if (buckets.moneyOrDataMovement.size > 0 && buckets.permissionChecks.size === 0) {
    risks.push(risk('Sensitive data or money movement lacks visible guardrails', 'high', 'Payment, export, transfer, or notification behavior appears without obvious local permission checks.', ['moneyOrDataMovement'], evidenceByKind));
  }

  if (buckets.trustBoundaries.size > 0 && buckets.stateTransitions.size > 0) {
    risks.push(risk('External input may drive state transitions', 'medium', 'Webhook, callback, upload, or external integration signals appear near state-changing workflow signals.', ['trustBoundaries', 'stateTransitions'], evidenceByKind));
  }

  if (buckets.approvalFlows.size > 0 && buckets.roles.size === 0) {
    risks.push(risk('Approval workflow needs role and separation-of-duty review', 'medium', 'Approval or moderation behavior was detected, but role modeling is not obvious from the sampled code.', ['approvalFlows'], evidenceByKind));
  }

  if (risks.length === 0) {
    risks.push({
      title: 'Business logic review requires domain context',
      severity: 'info',
      confidence: 0.35,
      workflow: 'repository-wide',
      hypothesis: 'No high-signal business workflow risk was detected heuristically. LLM review should ask domain questions before concluding low risk.',
      evidence: [],
      validationSteps: [
        'Identify the highest-value user actions and assets.',
        'Confirm who is allowed to perform each state-changing action.',
        'Check whether ownership and tenant boundaries are enforced server-side.'
      ]
    });
  }

  return risks;
}

function risk(
  title: string,
  severity: Severity,
  hypothesis: string,
  signalKinds: SignalKind[],
  evidenceByKind: Map<SignalKind, string[]>
): BusinessRisk {
  const evidence = [...new Set(signalKinds.flatMap((kind) => evidenceByKind.get(kind) ?? []))].slice(0, 12);
  return {
    title,
    severity,
    confidence: evidence.length > 0 ? 0.62 : 0.45,
    workflow: signalKinds.join(' + '),
    hypothesis,
    evidence,
    validationSteps: [
      'Map the actors and roles allowed to reach the workflow.',
      'Trace ownership, tenant, and approval checks on the server side.',
      'Add or verify abuse-case tests for bypass, replay, and privilege escalation paths.'
    ]
  };
}

function buildReviewQuestions(buckets: Record<SignalKind, Set<string>>): string[] {
  const questions = [
    'Which roles are allowed to perform each state-changing action?',
    'Which objects are tenant-scoped or owner-scoped, and where are those constraints enforced?',
    'Which workflows move money, expose data, send notifications, or call external systems?',
    'Which actions require approval, and can the initiator approve their own request?',
    'Which operations must be idempotent or replay-resistant?'
  ];

  if (buckets.trustBoundaries.size > 0) {
    questions.push('How are webhook, callback, upload, and external integration payloads authenticated and replay-protected?');
  }
  if (buckets.moneyOrDataMovement.size > 0) {
    questions.push('What business invariants prevent unauthorized refunds, exports, transfers, or account changes?');
  }
  return questions;
}

function sortedValues(values: Set<string>): string[] {
  return [...values].sort();
}
