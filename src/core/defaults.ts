// SPDX-License-Identifier: AGPL-3.0-only
import type {SecFlowConfig} from './types.js';

export const requiredPromptIds = [
  'repo-profile',
  'workflow-extraction',
  'business-invariant-review',
  'abuse-case-generation',
  'authorization-matrix',
  'tool-triage',
  'exploitability-review',
  'report-synthesis',
  'patch-draft'
] as const;

export const defaultConfig: SecFlowConfig = {
  version: 1,
  defaultRuntime: undefined,
  providers: {
    openai: {
      kind: 'openai',
      enabled: false,
      apiKeyEnv: 'OPENAI_API_KEY',
      defaultModel: 'gpt-5.4'
    },
    anthropic: {
      kind: 'anthropic',
      enabled: false,
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      defaultModel: 'claude-sonnet-4-6'
    },
    openrouter: {
      kind: 'openrouter',
      enabled: false,
      apiKeyEnv: 'OPENROUTER_API_KEY',
      defaultModel: 'openai/gpt-5.4'
    },
    codex: {
      kind: 'codex-cli',
      enabled: false,
      command: 'codex',
      defaultModel: 'gpt-5.4'
    },
    'claude-code': {
      kind: 'claude-code-cli',
      enabled: false,
      command: 'claude',
      defaultModel: 'sonnet'
    }
  },
  modelProfiles: {
    default: {
      provider: 'openai',
      model: 'gpt-5.4',
      temperature: 0.2,
      maxTokens: 4000,
      reasoningEffort: 'medium'
    },
    'business-logic': {
      provider: 'openai',
      model: 'gpt-5.4',
      temperature: 0.1,
      maxTokens: 5000,
      reasoningEffort: 'high',
      verbosity: 'high'
    }
  },
  tools: {
    semgrep: {
      enabled: true,
      command: 'semgrep',
      timeoutMs: 120000,
      outputLimitBytes: 10_000_000
    },
    trivy: {
      enabled: true,
      command: 'trivy',
      timeoutMs: 180000,
      outputLimitBytes: 20_000_000
    },
    joern: {
      enabled: true,
      command: 'joern-parse',
      timeoutMs: 300000,
      outputLimitBytes: 20_000_000
    }
  },
  prompts: {
    directory: 'prompts',
    required: [...requiredPromptIds]
  },
  playbooks: {
    default: 'playbooks/default-audit.yaml'
  },
  outputs: {
    directory: '.secflow'
  },
  context: {
    requireApproval: true,
    maxBytes: 750000,
    redactions: [
      "(api[_-]?key|token|secret|password)\\s*[:=]\\s*[\"']?[^\"'\\s]+",
      'authorization:\\s*bearer\\s+[^\\s]+'
    ]
  }
};
