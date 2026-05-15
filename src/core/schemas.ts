// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export const findingSourceSchema = z.enum(['semgrep', 'trivy', 'joern', 'business-logic', 'llm']);
export const workflowStepStateSchema = z.enum(['pending', 'running', 'waiting-for-approval', 'skipped', 'complete', 'failed']);
export const approvalKindSchema = z.enum(['llm-context', 'agent-context', 'patch-draft']);
export const artifactKindSchema = z.enum(['json', 'markdown', 'sarif', 'patch-draft', 'raw-log', 'text']);

export const repoProfileSchema = z.object({
  targetPath: z.string(),
  generatedAt: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  extensions: z.record(z.string(), z.number().int().nonnegative()),
  manifests: z.array(z.string()),
  securityRelevantFiles: z.array(z.string()),
  likelyFrameworks: z.array(z.string()),
  notableDirectories: z.array(z.string()),
  sampledFiles: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      signals: z.array(z.string())
    })
  )
});

export const repoMapSchema = z.object({
  generatedAt: z.string(),
  root: z.string(),
  manifests: z.array(z.string()),
  frameworks: z.array(z.string()),
  notableDirectories: z.array(z.string()),
  extensionSummary: z.record(z.string(), z.number().int().nonnegative()),
  sampledFiles: repoProfileSchema.shape.sampledFiles
});

export const businessRiskSchema = z.object({
  title: z.string(),
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  workflow: z.string(),
  hypothesis: z.string(),
  evidence: z.array(z.string()),
  validationSteps: z.array(z.string())
});

export const businessWorkflowModelSchema = z.object({
  generatedAt: z.string(),
  actors: z.array(z.string()),
  roles: z.array(z.string()),
  assets: z.array(z.string()),
  trustBoundaries: z.array(z.string()),
  entryPoints: z.array(z.string()),
  stateTransitions: z.array(z.string()),
  permissionChecks: z.array(z.string()),
  moneyOrDataMovement: z.array(z.string()),
  approvalFlows: z.array(z.string()),
  externalSideEffects: z.array(z.string()),
  reviewQuestions: z.array(z.string()),
  risks: z.array(businessRiskSchema)
});

export const normalizedFindingSchema = z.object({
  id: z.string(),
  source: findingSourceSchema,
  title: z.string(),
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  description: z.string(),
  evidence: z.array(z.string()),
  assumptions: z.array(z.string()).optional(),
  exploitPath: z.string().optional(),
  validationSteps: z.array(z.string()).optional(),
  recommendation: z.string(),
  cwe: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const toolRunResultSchema = z.object({
  tool: z.string(),
  command: z.string(),
  available: z.boolean(),
  skipped: z.boolean(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  stdoutPath: z.string().optional(),
  stderrPath: z.string().optional(),
  rawJsonPath: z.string().optional(),
  message: z.string(),
  findings: z.array(normalizedFindingSchema)
});

export const llmResponseSchema = z.object({
  runtime: z.string(),
  model: z.string().optional(),
  text: z.string(),
  structured: z.unknown().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  raw: z.unknown().optional()
});

export const llmRuntimeEventSchema = z.object({
  timestamp: z.string(),
  runtime: z.string(),
  taskId: z.string(),
  promptId: z.string(),
  type: z.enum(['start', 'status', 'message', 'stdout', 'stderr', 'complete', 'error']),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional()
});

export const workflowStepRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: workflowStepStateSchema,
  dependencies: z.array(z.string()),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  approvalKind: approvalKindSchema.optional(),
  error: z.string().optional(),
  artifactIds: z.array(z.string())
});

export const artifactRecordSchema = z.object({
  id: z.string(),
  kind: artifactKindSchema,
  path: z.string(),
  createdAt: z.string(),
  bytes: z.number().int().nonnegative(),
  description: z.string().optional()
});

export const evidenceItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['file', 'scanner', 'business-signal', 'llm', 'manual']),
  source: z.string(),
  summary: z.string(),
  artifactPath: z.string().optional(),
  findingIds: z.array(z.string())
});

export const approvalRecordSchema = z.object({
  id: z.string(),
  kind: approvalKindSchema,
  requestedAt: z.string(),
  resolvedAt: z.string().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
  artifactPath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const remediationDraftSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  title: z.string(),
  status: z.enum(['drafted', 'skipped']),
  createdAt: z.string(),
  artifactPath: z.string().optional(),
  summary: z.string(),
  patch: z.string()
});

const baseAuditEventSchema = z.object({
  type: z.string(),
  step: z.string(),
  timestamp: z.string()
});

export const caseFileSchema = z.object({
  version: z.literal(1),
  caseId: z.string(),
  title: z.string(),
  targetPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['open', 'complete', 'failed']),
  workflow: z.array(workflowStepRecordSchema),
  events: z.array(baseAuditEventSchema.passthrough()),
  artifacts: z.array(artifactRecordSchema),
  evidence: z.array(evidenceItemSchema),
  approvals: z.array(approvalRecordSchema),
  profile: repoProfileSchema.optional(),
  repoMap: repoMapSchema.optional(),
  business: businessWorkflowModelSchema.optional(),
  toolResults: z.array(toolRunResultSchema),
  findings: z.array(normalizedFindingSchema),
  llmResponses: z.array(llmResponseSchema),
  llmEvents: z.array(llmRuntimeEventSchema).default([]),
  remediationDrafts: z.array(remediationDraftSchema),
  reportPath: z.string().optional(),
  jsonReportPath: z.string().optional(),
  sarifPath: z.string().optional()
});

export function parseCaseFile(input: unknown) {
  return caseFileSchema.parse(input);
}
