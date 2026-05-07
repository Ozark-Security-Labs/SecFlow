// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import {spawnSync} from 'node:child_process';
import {render} from 'ink';
import {App} from './App.js';

const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H';
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';
const CLEAR_VIEWPORT = '\x1b[2J\x1b[3J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET_TERMINAL_INPUT_MODES = [
  '\x1b[?9001l', // Windows Terminal / ConPTY win32-input-mode.
  '\x1b[?2004l', // Bracketed paste.
  '\x1b[?1004l', // Focus events.
  '\x1b[?1000l',
  '\x1b[?1002l',
  '\x1b[?1003l',
  '\x1b[?1006l',
  '\x1b[?1015l',
  '\x1b[?1l',
  '\x1b>',
  '\x1b[>4;0m',
  '\x1b[<u'
].join('');

export async function renderFullscreenTui(cwd: string): Promise<void> {
  const stdout = process.stdout;
  const strategy = resolveFullscreenStrategy();
  const useFullscreen = Boolean(stdout.isTTY);
  const useAlternateScreen = useFullscreen && strategy === 'alternate';
  let restored = false;

  const restoreSync = () => {
    if (!useFullscreen || restored) {
      return;
    }
    restored = true;
    restoreCookedInputMode();
    restoreWindowsConsoleInputMode();
    stdout.write(`${RESET_TERMINAL_INPUT_MODES}${SHOW_CURSOR}`);
    stdout.write(useAlternateScreen ? LEAVE_ALTERNATE_SCREEN : CLEAR_VIEWPORT);
    stdout.write(`${RESET_TERMINAL_INPUT_MODES}${SHOW_CURSOR}`);
  };

  const restore = async () => {
    if (!useFullscreen || restored) {
      return;
    }
    restored = true;
    restoreCookedInputMode();
    restoreWindowsConsoleInputMode();
    await writeAndDrain(stdout, `${RESET_TERMINAL_INPUT_MODES}${SHOW_CURSOR}`);
    await writeAndDrain(stdout, useAlternateScreen ? LEAVE_ALTERNATE_SCREEN : CLEAR_VIEWPORT);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeAndDrain(stdout, `${RESET_TERMINAL_INPUT_MODES}${SHOW_CURSOR}`);
    restorePosixTerminalMode();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  if (useFullscreen) {
    const enter = useAlternateScreen ? ENTER_ALTERNATE_SCREEN : CLEAR_VIEWPORT;
    stdout.write(`${RESET_TERMINAL_INPUT_MODES}${enter}${HIDE_CURSOR}`);
  }

  const instance = render(<App cwd={cwd} screenMode={strategy} />, {
    stdout,
    stdin: process.stdin,
    stderr: process.stderr,
    exitOnCtrlC: true,
    patchConsole: true,
    incrementalRendering: true,
    maxFps: 20,
    kittyKeyboard: {mode: 'disabled'}
  });

  process.once('exit', restoreSync);

  try {
    await instance.waitUntilExit();
  } finally {
    process.off('exit', restoreSync);
    instance.cleanup();
    await restore();
  }
}

function resolveFullscreenStrategy(): 'alternate' | 'viewport' {
  const forced = process.env.SECFLOW_TUI_SCREEN?.toLowerCase();
  if (forced === 'alternate' || forced === 'viewport') {
    return forced;
  }

  // Alternate screen is the only reliable way to keep Ink repainting in-place
  // across WSL/Windows Terminal. Input protocol cleanup below handles the
  // terminal-mode issue that originally pushed us toward viewport mode.
  return 'alternate';
}

function restoreCookedInputMode(): void {
  if (!process.stdin.isTTY) {
    return;
  }
  try {
    process.stdin.setRawMode(false);
  } catch {
    // Best effort only. Some redirected or ConPTY-backed streams reject this.
  }
}

function restoreWindowsConsoleInputMode(): void {
  if (process.platform !== 'win32') {
    return;
  }

  const script = `
Add-Type -Namespace SecFlow -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern System.IntPtr GetStdHandle(int nStdHandle);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out int lpMode);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, int dwMode);
'@
$h = [SecFlow.Native]::GetStdHandle(-10)
$mode = 0
if ([SecFlow.Native]::GetConsoleMode($h, [ref]$mode)) {
  $ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200
  $ENABLE_PROCESSED_INPUT = 0x0001
  $ENABLE_LINE_INPUT = 0x0002
  $ENABLE_ECHO_INPUT = 0x0004
  $restored = ($mode -band (-bnot $ENABLE_VIRTUAL_TERMINAL_INPUT)) -bor $ENABLE_PROCESSED_INPUT -bor $ENABLE_LINE_INPUT -bor $ENABLE_ECHO_INPUT
  [SecFlow.Native]::SetConsoleMode($h, $restored) | Out-Null
}
`;

  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 1000
  });
}

function restorePosixTerminalMode(): void {
  if (process.platform === 'win32') {
    return;
  }

  const script = `
if [ -e /dev/tty ]; then
  stty sane < /dev/tty 2>/dev/null || true
  printf '\\033[?9001l\\033[?2004l\\033[?1004l\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l\\033[?1015l\\033[?1l\\033>\\033[>4;0m\\033[<u\\033[?25h' > /dev/tty 2>/dev/null || true
fi
`;

  spawnSync('sh', ['-c', script], {
    stdio: 'ignore',
    timeout: 1000
  });
}

async function writeAndDrain(stream: NodeJS.WriteStream, value: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    if (stream.write(value, done)) {
      return;
    }
    stream.once('drain', done);
  });
}
