import {execa} from 'execa';

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

export function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
