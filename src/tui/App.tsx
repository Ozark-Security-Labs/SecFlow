// SPDX-License-Identifier: AGPL-3.0-only
import React, {useRef, useState} from 'react';
import path from 'node:path';
import {Box, Text, useApp, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type {AuditEvent, AuditRun, ContextPreview} from '../core/types.js';
import {runAudit as defaultRunAudit, type AuditOptions} from '../core/auditEngine.js';
import {ContextApprovalSummary, EventLog, PreflightSummary, ProgressRail, ResultsSummary, Section} from './components.js';
import {fitText, TerminalSizeProvider, useTerminalSize} from './layout.js';
import {loadPreflightData, type PreflightData} from './preflight.js';
import {theme} from './theme.js';

type Screen = 'home' | 'commands' | 'target' | 'preflight-loading' | 'preflight' | 'running' | 'context-approval' | 'results' | 'error' | 'confirm-exit';
type HomeAction = 'start' | 'commands' | 'quit';
type PreflightAction = 'run' | 'back' | 'quit';
type ApprovalAction = 'approve' | 'skip';
type ConfirmExitAction = 'stay' | 'exit';

export interface AppProps {
  cwd: string;
  screenMode?: 'alternate' | 'viewport';
  loadPreflight?: (cwd: string, targetPath: string) => Promise<PreflightData>;
  runAudit?: (options: AuditOptions) => Promise<AuditRun>;
}

export function App({cwd, screenMode = 'viewport', loadPreflight = loadPreflightData, runAudit = defaultRunAudit}: AppProps): React.ReactElement {
  return (
    <TerminalSizeProvider>
      <AppBody cwd={cwd} screenMode={screenMode} loadPreflight={loadPreflight} runAudit={runAudit} />
    </TerminalSizeProvider>
  );
}

interface AppBodyProps {
  cwd: string;
  screenMode: 'alternate' | 'viewport';
  loadPreflight: (cwd: string, targetPath: string) => Promise<PreflightData>;
  runAudit: (options: AuditOptions) => Promise<AuditRun>;
}

function AppBody({cwd, screenMode, loadPreflight, runAudit}: AppBodyProps): React.ReactElement {
  const {exit} = useApp();
  const terminal = useTerminalSize();
  const fullHeight = screenMode === 'alternate';
  const [screen, setScreen] = useState<Screen>('home');
  const [targetPath, setTargetPath] = useState(cwd);
  const [preflight, setPreflight] = useState<PreflightData | undefined>();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [run, setRun] = useState<AuditRun | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [approvalRequest, setApprovalRequest] = useState<{preview: ContextPreview; resolve: (approved: boolean) => void} | undefined>();
  const [selectionIndexes, setSelectionIndexes] = useState<Record<string, number>>({});
  const activeRun = useRef(false);

  useInput((input, key) => {
    if (key.tab || input === '\t') {
      advanceSelection(screen, setSelectionIndexes);
    }
    if ((key.return || input === '\r' || input === '\n') && screen === 'target') {
      void preparePreflight(targetPath);
    }
    if (input === 'q') {
      if (activeRun.current) {
        setScreen('confirm-exit');
      } else {
        exit();
      }
    }
    if (key.escape) {
      if (screen === 'target') setScreen('home');
      if (screen === 'commands') setScreen('home');
      if (screen === 'preflight') setScreen('target');
      if (screen === 'results' || screen === 'error') setScreen('home');
      if (screen === 'running' || screen === 'context-approval') setScreen('confirm-exit');
      if (screen === 'confirm-exit') setScreen(activeRun.current ? 'running' : 'home');
    }
  });

  async function preparePreflight(value: string): Promise<void> {
    const requestedPath = value.trim() || cwd;
    setTargetPath(requestedPath);
    setError(undefined);
    setScreen('preflight-loading');
    try {
      setPreflight(await loadPreflight(cwd, requestedPath));
      setScreen('preflight');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setScreen('error');
    }
  }

  async function startAudit(): Promise<void> {
    if (!preflight) {
      return;
    }
    activeRun.current = true;
    setEvents([]);
    setRun(undefined);
    setApprovalRequest(undefined);
    setError(undefined);
    setScreen('running');

    try {
      const completedRun = await runAudit({
        targetPath: preflight.targetPath,
        config: preflight.config,
        runtime: preflight.defaultRuntime,
        onEvent: (event) => setEvents((current) => [...current, event]),
        approveContext: (preview) =>
          new Promise<boolean>((resolve) => {
            setApprovalRequest({preview, resolve});
            setScreen('context-approval');
          })
      });
      setRun(completedRun);
      setScreen('results');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setScreen('error');
    } finally {
      activeRun.current = false;
      setApprovalRequest(undefined);
    }
  }

  function resolveApproval(approved: boolean): void {
    approvalRequest?.resolve(approved);
    setApprovalRequest(undefined);
    setScreen('running');
  }

  return (
    <Box
      flexDirection="column"
      width={terminal.columns}
      height={fullHeight ? terminal.rows : undefined}
      overflow={fullHeight ? 'hidden' : undefined}
      paddingX={terminal.spacious ? 1 : 0}
      paddingY={terminal.spacious ? 1 : 0}
    >
      <Box flexDirection="column" flexGrow={fullHeight ? 1 : undefined} overflow={fullHeight ? 'hidden' : undefined}>
        <Header cwd={cwd} screen={screen} />
        {terminal.rows < 18 ? <Text color={theme.warning}>Terminal is short; expand it for the full audit view.</Text> : null}
        {screen === 'home' && <HomeScreen initialIndex={selectionIndexes.home ?? 0} onSelect={(action) => handleHomeAction(action, setScreen, exit)} />}
        {screen === 'commands' && <CommandsScreen />}
        {screen === 'target' && <TargetScreen value={targetPath} onChange={setTargetPath} onSubmit={preparePreflight} />}
        {screen === 'preflight-loading' && <LoadingScreen label="Checking config, tools, and runtimes..." />}
        {screen === 'preflight' && preflight && <PreflightScreen data={preflight} initialIndex={selectionIndexes.preflight ?? 0} onSelect={(action) => handlePreflightAction(action, startAudit, setScreen, exit)} />}
        {screen === 'running' && <RunningScreen events={events} />}
        {screen === 'context-approval' && approvalRequest && <ContextApprovalScreen events={events} preview={approvalRequest.preview} initialIndex={selectionIndexes['context-approval'] ?? 0} onSelect={resolveApproval} />}
        {screen === 'results' && run && <ResultsScreen events={events} run={run} initialIndex={selectionIndexes.results ?? 0} onSelect={(action) => (action === 'home' ? setScreen('home') : exit())} />}
        {screen === 'error' && <ErrorScreen message={error ?? 'Unknown error'} />}
        {screen === 'confirm-exit' && <ConfirmExitScreen initialIndex={selectionIndexes['confirm-exit'] ?? 0} onSelect={(action) => handleExitConfirmation(action, approvalRequest?.resolve, setScreen, exit)} />}
      </Box>
      <Footer screen={screen} />
    </Box>
  );
}

function Header({cwd, screen}: {cwd: string; screen: Screen}): React.ReactElement {
  const terminal = useTerminalSize();
  const label = ` / ${screen} / ${cwd}`;
  return (
    <Text>
      <Text bold color={theme.brand}>SecFlow</Text>
      <Text color={theme.muted}>{fitText(label, terminal.columns - 7)}</Text>
    </Text>
  );
}

export function HomeScreen({onSelect, initialIndex = 0}: {onSelect: (action: HomeAction) => void; initialIndex?: number}): React.ReactElement {
  return (
    <>
      <Splash />
      <Section title="Home">
        <SelectInput<HomeAction>
          key={`home-${initialIndex}`}
          initialIndex={initialIndex}
          items={[
            {label: 'Start audit wizard', value: 'start'},
            {label: 'View command reference', value: 'commands'},
            {label: 'Quit', value: 'quit'}
          ]}
          onSelect={(item) => onSelect(item.value)}
        />
      </Section>
    </>
  );
}

function Splash(): React.ReactElement {
  const terminal = useTerminalSize();
  if (terminal.compact || terminal.narrow) {
    return (
      <Box flexDirection="column">
        <Text color={theme.brand}>SecFlow</Text>
        <Text color={theme.muted}>AppSec audit harness for code, scanners, and business logic.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color={theme.brand}>{'   _____          ______ __'}</Text>
      <Text color={theme.brand}>{'  / ___/___  ____/ ____// /___ _      __'}</Text>
      <Text color={theme.brand}>{'  \\__ \\/ _ \\/ __  /_   / / __ \\ | /| / /'}</Text>
      <Text color={theme.brand}>{' ___/ /  __/ /_/ __/  / / /_/ / |/ |/ /'}</Text>
      <Text color={theme.brand}>{'/____/\\___/\\__,_/_/  /_/\\____/|__/|__/'}</Text>
      <Text color={theme.muted}>AppSec audit harness for code, scanners, and business logic.</Text>
    </Box>
  );
}

export function CommandsScreen(): React.ReactElement {
  return (
    <Section title="Commands">
      <Text>secflow init</Text>
      <Text>secflow audit . --approve-context</Text>
      <Text>secflow tools doctor</Text>
      <Text>secflow models list</Text>
      <Text>secflow playbooks validate playbooks/default-audit.yaml</Text>
    </Section>
  );
}

export function TargetScreen({value, onChange, onSubmit}: {value: string; onChange: (value: string) => void; onSubmit: (value: string) => void}): React.ReactElement {
  return (
    <Section title="Target Repository">
      <Text>Enter the repository path to audit.</Text>
      <Box>
        <Text color={theme.muted}>Path: </Text>
        <TextInput value={value} focus showCursor onChange={onChange} onSubmit={onSubmit} placeholder={path.resolve('.')} />
      </Box>
    </Section>
  );
}

export function LoadingScreen({label}: {label: string}): React.ReactElement {
  return (
    <Section title="Loading">
      <Text>
        <Text color={theme.brand}>
          <Spinner type="dots" />
        </Text>{' '}
        {label}
      </Text>
    </Section>
  );
}

export function PreflightScreen({data, onSelect, initialIndex = 0}: {data: PreflightData; onSelect: (action: PreflightAction) => void; initialIndex?: number}): React.ReactElement {
  return (
    <>
      <PreflightSummary data={data} />
      <Section title="Next">
        <SelectInput<PreflightAction>
          key={`preflight-${initialIndex}`}
          initialIndex={initialIndex}
          items={[
            {label: 'Run audit', value: 'run'},
            {label: 'Back to target path', value: 'back'},
            {label: 'Quit', value: 'quit'}
          ]}
          onSelect={(item) => onSelect(item.value)}
        />
      </Section>
    </>
  );
}

export function RunningScreen({events}: {events: AuditEvent[]}): React.ReactElement {
  return (
    <>
      <LoadingScreen label="Audit running..." />
      <ProgressRail events={events} />
      <EventLog events={events} />
    </>
  );
}

export function ContextApprovalScreen({events = [], preview, onSelect, initialIndex = 0}: {events?: AuditEvent[]; preview: ContextPreview; onSelect: (approved: boolean) => void; initialIndex?: number}): React.ReactElement {
  return (
    <>
      <ProgressRail events={events} />
      <ContextApprovalSummary preview={preview} />
      <Section title="Decision">
        <SelectInput<ApprovalAction>
          key={`approval-${initialIndex}`}
          initialIndex={initialIndex}
          items={[
            {label: 'Approve LLM runtime call', value: 'approve'},
            {label: 'Skip LLM runtime call', value: 'skip'}
          ]}
          onSelect={(item) => onSelect(item.value === 'approve')}
        />
      </Section>
    </>
  );
}

export function ResultsScreen({run, onSelect, events = [], initialIndex = 0}: {run: AuditRun; onSelect: (action: 'home' | 'quit') => void; events?: AuditEvent[]; initialIndex?: number}): React.ReactElement {
  return (
    <>
      <ProgressRail events={events} />
      <ResultsSummary run={run} />
      <Section title="Next">
        <SelectInput<'home' | 'quit'>
          key={`results-${initialIndex}`}
          initialIndex={initialIndex}
          items={[
            {label: 'Back home', value: 'home'},
            {label: 'Quit', value: 'quit'}
          ]}
          onSelect={(item) => onSelect(item.value)}
        />
      </Section>
    </>
  );
}

export function ErrorScreen({message}: {message: string}): React.ReactElement {
  return (
    <Section title="Error">
      <Text color={theme.danger}>{message}</Text>
    </Section>
  );
}

export function ConfirmExitScreen({onSelect, initialIndex = 0}: {onSelect: (action: ConfirmExitAction) => void; initialIndex?: number}): React.ReactElement {
  return (
    <Section title="Exit Active Run?">
      <Text color={theme.warning}>An audit is active or waiting for approval.</Text>
      <SelectInput<ConfirmExitAction>
        key={`confirm-${initialIndex}`}
        initialIndex={initialIndex}
        items={[
          {label: 'Keep running', value: 'stay'},
          {label: 'Exit SecFlow', value: 'exit'}
        ]}
        onSelect={(item) => onSelect(item.value)}
      />
    </Section>
  );
}

function Footer({screen}: {screen: Screen}): React.ReactElement {
  const terminal = useTerminalSize();
  return <Text color={theme.muted}>{fitText(footerText(screen), terminal.columns)}</Text>;
}

function footerText(screen: Screen): string {
  if (screen === 'home') return 'Enter selects. Tab or arrows move. q quits.';
  if (screen === 'target') return 'Enter confirms the target. Esc returns home. q quits.';
  if (screen === 'preflight') return 'Enter starts or changes direction. Esc edits target. q quits.';
  if (screen === 'running') return 'Audit is running. q asks before exiting.';
  if (screen === 'context-approval') return 'Review the preview path, then approve or skip. q asks before exiting.';
  if (screen === 'results') return 'Report and SARIF paths are ready. Enter selects next action. q quits.';
  if (screen === 'confirm-exit') return 'Enter confirms the highlighted choice.';
  return 'Esc backs out where available. q quits.';
}

function handleHomeAction(action: HomeAction, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'start') setScreen('target');
  if (action === 'commands') setScreen('commands');
  if (action === 'quit') exit();
}

function handlePreflightAction(action: PreflightAction, startAudit: () => void, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'run') void startAudit();
  if (action === 'back') setScreen('target');
  if (action === 'quit') exit();
}

function handleExitConfirmation(action: ConfirmExitAction, resolveApproval: ((approved: boolean) => void) | undefined, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'stay') {
    setScreen(resolveApproval ? 'context-approval' : 'running');
    return;
  }
  resolveApproval?.(false);
  exit();
}

function advanceSelection(screen: Screen, setSelectionIndexes: React.Dispatch<React.SetStateAction<Record<string, number>>>): void {
  const limits: Partial<Record<Screen, number>> = {
    home: 3,
    preflight: 3,
    'context-approval': 2,
    results: 2,
    'confirm-exit': 2
  };
  const limit = limits[screen];
  if (!limit) {
    return;
  }
  setSelectionIndexes((current) => ({
    ...current,
    [screen]: ((current[screen] ?? 0) + 1) % limit
  }));
}
