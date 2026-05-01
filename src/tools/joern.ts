import path from 'node:path';
import type {ToolAdapter} from './adapter.js';
import {runToolCommand} from './adapter.js';

export const joernAdapter: ToolAdapter = {
  name: 'joern',
  defaultCommand: 'joern-parse',
  run(targetPath, runDir, config) {
    const outputPath = path.join(runDir, 'raw', 'joern-cpg.bin');
    const args = config.args ?? [targetPath, '--output', outputPath];
    return runToolCommand('joern', targetPath, runDir, config, args, () => []);
  }
};
