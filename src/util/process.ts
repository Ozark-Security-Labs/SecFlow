// SPDX-License-Identifier: AGPL-3.0-only
import {execa} from 'execa';
import {spawn} from 'node:child_process';

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  input?: string;
  env?: Record<string, string | undefined>;
  outputLimitBytes?: number;
}

export interface ProcessRunResult {
  commandLine: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ProcessOutputEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execa('where.exe', [command], {reject: true});
    } else {
      await execa('sh', ['-lc', `command -v ${quoteForShell(command)}`], {reject: true});
    }
    return true;
  } catch {
    return false;
  }
}

export async function commandVersion(command: string): Promise<string | undefined> {
  for (const args of [['--version'], ['version'], ['-v']]) {
    try {
      const result = await execa(command, args, {timeout: 5000, reject: false});
      const output = `${result.stdout}\n${result.stderr}`.trim();
      if (output.length > 0) {
        return output.split(/\r?\n/)[0];
      }
    } catch {
      // Try the next conventional version flag.
    }
  }
  return undefined;
}

export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  const started = Date.now();
  try {
    const result = await execa(options.command, options.args, {
      cwd: options.cwd,
      input: options.input,
      timeout: options.timeoutMs,
      reject: false,
      env: options.env,
      maxBuffer: options.outputLimitBytes
    });
    return {
      commandLine: formatCommandLine(options.command, options.args),
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - started,
      timedOut: false
    };
  } catch (error) {
    const err = error as {shortMessage?: string; stdout?: string; stderr?: string; timedOut?: boolean; exitCode?: number};
    return {
      commandLine: formatCommandLine(options.command, options.args),
      exitCode: typeof err.exitCode === 'number' ? err.exitCode : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.shortMessage ?? String(error),
      durationMs: Date.now() - started,
      timedOut: Boolean(err.timedOut)
    };
  }
}

export async function runProcessStreaming(options: ProcessRunOptions, onOutput: (event: ProcessOutputEvent) => void): Promise<ProcessRunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {...process.env, ...options.env},
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }, options.timeoutMs);

    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
      stdoutRemainder = emitCompleteLines(stdoutRemainder + chunk, 'stdout', onOutput);
    });
    child.stderr!.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      stderrRemainder = emitCompleteLines(stderrRemainder + chunk, 'stderr', onOutput);
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        commandLine: formatCommandLine(options.command, options.args),
        exitCode: 1,
        stdout: stdoutChunks.join(''),
        stderr: `${stderrChunks.join('')}${error.message}`,
        durationMs: Date.now() - started,
        timedOut
      });
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (stdoutRemainder.trim()) onOutput({stream: 'stdout', line: stdoutRemainder});
      if (stderrRemainder.trim()) onOutput({stream: 'stderr', line: stderrRemainder});
      resolve({
        commandLine: formatCommandLine(options.command, options.args),
        exitCode: exitCode ?? 0,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        durationMs: Date.now() - started,
        timedOut
      });
    });
    if (options.input !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
  });
}

export function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function emitCompleteLines(value: string, stream: ProcessOutputEvent['stream'], onOutput: (event: ProcessOutputEvent) => void): string {
  const lines = value.split(/\r?\n/);
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim()) {
      onOutput({stream, line});
    }
  }
  return remainder;
}
