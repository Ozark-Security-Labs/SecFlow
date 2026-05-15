// SPDX-License-Identifier: AGPL-3.0-only
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {z} from 'zod';
import {defaultConfig} from './defaults.js';
import type {SecFlowConfig} from './types.js';

const providerSchema = z.object({
  kind: z.enum(['openai', 'anthropic', 'openrouter', 'codex-cli', 'claude-code-cli']),
  enabled: z.boolean().default(false),
  baseUrl: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  command: z.string().optional(),
  defaultModel: z.string().optional(),
  args: z.array(z.string()).optional()
});

const configSchema = z.object({
  version: z.literal(1),
  defaultRuntime: z.string().optional(),
  providers: z.record(z.string(), providerSchema),
  modelProfiles: z.record(
    z.string(),
    z.object({
      provider: z.string(),
      model: z.string(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      maxTokens: z.number().int().positive().optional(),
      reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
      verbosity: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      extra: z.record(z.string(), z.unknown()).optional()
    })
  ),
  tools: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      command: z.string(),
      timeoutMs: z.number().int().positive(),
      outputLimitBytes: z.number().int().positive(),
      args: z.array(z.string()).optional()
    })
  ),
  prompts: z.object({
    directory: z.string(),
    required: z.array(z.string()).min(1)
  }),
  playbooks: z.object({
    default: z.string()
  }),
  outputs: z.object({
    directory: z.string()
  }),
  runtime: z
    .object({
      streamEvents: z.boolean()
    })
    .default(defaultConfig.runtime),
  context: z.object({
    requireApproval: z.boolean(),
    maxBytes: z.number().int().positive(),
    redactions: z.array(z.string())
  })
});

export function validateConfig(input: unknown): SecFlowConfig {
  return configSchema.parse(input);
}

export function createDefaultConfigYaml(): string {
  return YAML.stringify(defaultConfig);
}

export async function loadConfig(cwd: string): Promise<{config: SecFlowConfig; path?: string}> {
  const configPath = path.join(cwd, '.secflow', 'config.yaml');
  try {
    await access(configPath);
  } catch {
    return {config: validateConfig(defaultConfig)};
  }

  const raw = await readFile(configPath, 'utf8');
  const parsed = YAML.parse(raw) as unknown;
  return {config: validateConfig(parsed), path: configPath};
}

export async function writeDefaultConfig(cwd: string, options: {overwrite?: boolean} = {}): Promise<string> {
  const secflowDir = path.join(cwd, '.secflow');
  await mkdir(secflowDir, {recursive: true});
  const configPath = path.join(secflowDir, 'config.yaml');
  try {
    await access(configPath);
    if (!options.overwrite) {
      return configPath;
    }
  } catch {
    // File does not exist yet.
  }
  await writeFile(configPath, createDefaultConfigYaml(), {encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx'});
  return configPath;
}

export async function saveConfig(cwd: string, config: SecFlowConfig): Promise<{config: SecFlowConfig; path: string}> {
  const validated = validateConfig(config);
  const secflowDir = path.join(cwd, '.secflow');
  await mkdir(secflowDir, {recursive: true});
  const configPath = path.join(secflowDir, 'config.yaml');
  await writeFile(configPath, YAML.stringify(validated), 'utf8');
  return {config: validated, path: configPath};
}

export async function updateConfig(cwd: string, update: (config: SecFlowConfig) => SecFlowConfig): Promise<{config: SecFlowConfig; path: string}> {
  const {config} = await loadConfig(cwd);
  return saveConfig(cwd, update(config));
}
