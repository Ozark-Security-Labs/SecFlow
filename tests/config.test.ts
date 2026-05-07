// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import YAML from 'yaml';
import {createDefaultConfigYaml, loadConfig, validateConfig, writeDefaultConfig} from '../src/core/config.js';

describe('config', () => {
  it('validates the built-in default config yaml', () => {
    const yaml = createDefaultConfigYaml();
    expect(yaml).toContain('providers:');
    expect(() => validateConfig(YAML.parse(yaml))).not.toThrow();
  });

  it('loads defaults when project config is absent', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'secflow-config-'));
    const {config, path: configPath} = await loadConfig(cwd);
    expect(configPath).toBeUndefined();
    expect(config.tools.semgrep?.enabled).toBe(true);
  });

  it('writes a default project config', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'secflow-config-'));
    const configPath = await writeDefaultConfig(cwd);
    expect(configPath.endsWith(path.join('.secflow', 'config.yaml'))).toBe(true);
    expect(await readFile(configPath, 'utf8')).toContain('business-logic');
  });
});
