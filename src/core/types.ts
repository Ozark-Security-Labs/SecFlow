// SPDX-License-Identifier: AGPL-3.0-only
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type FindingSource = 'semgrep' | 'trivy' | 'joern' | 'business-logic' | 'llm';

export type RuntimeKind = 'openai' | 'anthropic' | 'openrouter' | 'codex-cli' | 'claude-code-cli';

export interface ModelProfile {
  provider: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  verbosity?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  extra?: Record<string, unknown>;
}

export interface ProviderConfig {
  kind: RuntimeKind;
  enabled: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
  command?: string;
  defaultModel?: string;
  args?: string[];
}

export interface ToolConfig {
  enabled: boolean;
  command: string;
  timeoutMs: number;
  outputLimitBytes: number;
  args?: string[];
}

export interface SecFlowConfig {
  version: 1;
  defaultRuntime?: string;
  providers: Record<string, ProviderConfig>;
  modelProfiles: Record<string, ModelProfile>;
  tools: Record<string, ToolConfig>;
  prompts: {
    directory: string;
    required: string[];
  };
  playbooks: {
    default: string;
  };
  outputs: {
    directory: string;
  };
  context: {
    requireApproval: boolean;
    maxBytes: number;
    redactions: string[];
  };
}

export interface RepoProfile {
  targetPath: string;
  generatedAt: string;
  fileCount: number;
  totalBytes: number;
  extensions: Record<string, number>;
  manifests: string[];
  securityRelevantFiles: string[];
  likelyFrameworks: string[];
  notableDirectories: string[];
  sampledFiles: Array<{
    path: string;
    bytes: number;
    signals: string[];
  }>;
}

export interface BusinessWorkflowModel {
  generatedAt: string;
  actors: string[];
  roles: string[];
  assets: string[];
  trustBoundaries: string[];
  entryPoints: string[];
  stateTransitions: string[];
  permissionChecks: string[];
  moneyOrDataMovement: string[];
  approvalFlows: string[];
  externalSideEffects: string[];
  reviewQuestions: string[];
  risks: BusinessRisk[];
}

export interface BusinessRisk {
  title: string;
  severity: Severity;
  confidence: number;
  workflow: string;
  hypothesis: string;
  evidence: string[];
  validationSteps: string[];
}

export interface NormalizedFinding {
  id: string;
  source: FindingSource;
  title: string;
  severity: Severity;
  confidence: number;
  path?: string;
  line?: number;
  description: string;
  evidence: string[];
  recommendation: string;
  cwe?: string[];
  references?: string[];
  metadata?: Record<string, unknown>;
}

export interface ToolRunResult {
  tool: string;
  command: string;
  available: boolean;
  skipped: boolean;
  exitCode?: number;
  durationMs: number;
  stdoutPath?: string;
  stderrPath?: string;
  rawJsonPath?: string;
  message: string;
  findings: NormalizedFinding[];
}

export interface LlmTask {
  id: string;
  promptId: string;
  systemPrompt: string;
  userPrompt: string;
  targetPath: string;
  context: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface LlmResponse {
  runtime: string;
  model?: string;
  text: string;
  structured?: unknown;
  usage?: Record<string, unknown>;
  raw?: unknown;
}

export interface AuditRun {
  runId: string;
  targetPath: string;
  runDir: string;
  profile: RepoProfile;
  business: BusinessWorkflowModel;
  toolResults: ToolRunResult[];
  findings: NormalizedFinding[];
  llmResponses: LlmResponse[];
  reportPath: string;
  sarifPath: string;
}

export type AuditStep =
  | 'initialize'
  | 'profile'
  | 'business-workflows'
  | 'tools'
  | 'context-preview'
  | 'llm'
  | 'reports'
  | 'complete'
  | 'error';

export interface ContextPreview {
  runtime: string;
  promptId: string;
  sizeBytes: number;
  maxBytes: number;
  requireApproval: boolean;
  redactionPatternCount: number;
  contextPath: string;
}

export type AuditEvent =
  | {
      type: 'step:start' | 'step:complete';
      step: AuditStep;
      message: string;
      timestamp: string;
      data?: Record<string, unknown>;
    }
  | {
      type: 'tool:complete';
      step: 'tools';
      timestamp: string;
      result: ToolRunResult;
    }
  | {
      type: 'context:preview';
      step: 'context-preview';
      timestamp: string;
      preview: ContextPreview;
    }
  | {
      type: 'llm:skipped';
      step: 'llm';
      timestamp: string;
      reason: string;
    }
  | {
      type: 'run:complete';
      step: 'complete';
      timestamp: string;
      run: AuditRun;
    }
  | {
      type: 'error';
      step: 'error';
      timestamp: string;
      message: string;
      error?: unknown;
    };
