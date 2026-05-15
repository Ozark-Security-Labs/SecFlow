// SPDX-License-Identifier: AGPL-3.0-only
import React, {useRef, useState} from 'react';
import path from 'node:path';
import {Box, Text, useApp, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type {AuditEvent, AuditRun, ContextPreview, NormalizedFinding, SecFlowConfig} from '../core/types.js';
import {runAudit as defaultRunAudit, type AuditOptions} from '../core/auditEngine.js';
import {loadConfig, updateConfig} from '../core/config.js';
import {listSavedRuns as defaultListSavedRuns, loadSavedRun as defaultLoadSavedRun, type SavedRunSummary} from '../core/savedRuns.js';
import {
  ContextApprovalSummary,
  EventLog,
  FindingDetail,
  FindingsMenu,
  LlmActivitySummary,
  LlmRuntimeEventsSummary,
  PreflightSummary,
  ProgressRail,
  RemediationSummary,
  ReportArtifactsSummary,
  RepoMapSummary,
  ResultsSummary,
  Section,
  StatusRow,
  ToolOutcomeSummary,
  WorkflowSummary
} from './components.js';
import {fitText, TerminalSizeProvider, useTerminalSize} from './layout.js';
import {loadPreflightData, type PreflightData} from './preflight.js';
import {theme} from './theme.js';

type Screen = 'home' | 'commands' | 'config-loading' | 'config' | 'target' | 'history-loading' | 'history' | 'preflight-loading' | 'preflight' | 'running' | 'context-approval' | 'draft-approval' | 'results' | 'error' | 'confirm-exit';
type HomeAction = 'start' | 'history' | 'config' | 'commands' | 'quit';
export type ConfigAction = `use-runtime:${string}` | 'disable-runtime' | 'toggle-context-approval' | 'toggle-runtime-events' | 'home' | 'quit';
type HistoryAction = `run:${string}` | 'home' | 'quit';
type PreflightAction = 'run' | 'history' | 'back' | 'quit';
type ApprovalAction = 'approve' | 'skip';
type ConfirmExitAction = 'stay' | 'exit';
export type ResultsView = 'overview' | 'analysis' | 'reports' | 'findings' | 'finding-detail' | 'drafts';
export type ResultsAction = ResultsView | 'home' | 'quit' | `finding:${number}` | `findings-page:${number}`;

export interface AppProps {
  cwd: string;
  screenMode?: 'alternate' | 'viewport';
  loadPreflight?: (cwd: string, targetPath: string) => Promise<PreflightData>;
  runAudit?: (options: AuditOptions) => Promise<AuditRun>;
  listSavedRuns?: (targetPath: string) => Promise<SavedRunSummary[]>;
  loadSavedRun?: (targetPath: string, caseId: string) => Promise<AuditRun>;
}

export function App({
  cwd,
  screenMode = 'viewport',
  loadPreflight = loadPreflightData,
  runAudit = defaultRunAudit,
  listSavedRuns = defaultListSavedRuns,
  loadSavedRun = defaultLoadSavedRun
}: AppProps): React.ReactElement {
  return (
    <TerminalSizeProvider>
      <AppBody cwd={cwd} screenMode={screenMode} loadPreflight={loadPreflight} runAudit={runAudit} listSavedRuns={listSavedRuns} loadSavedRun={loadSavedRun} />
    </TerminalSizeProvider>
  );
}

interface AppBodyProps {
  cwd: string;
  screenMode: 'alternate' | 'viewport';
  loadPreflight: (cwd: string, targetPath: string) => Promise<PreflightData>;
  runAudit: (options: AuditOptions) => Promise<AuditRun>;
  listSavedRuns: (targetPath: string) => Promise<SavedRunSummary[]>;
  loadSavedRun: (targetPath: string, caseId: string) => Promise<AuditRun>;
}

function AppBody({cwd, screenMode, loadPreflight, runAudit, listSavedRuns, loadSavedRun}: AppBodyProps): React.ReactElement {
  const {exit} = useApp();
  const terminal = useTerminalSize();
  const fullHeight = screenMode === 'alternate';
  const [screen, setScreen] = useState<Screen>('home');
  const [targetPath, setTargetPath] = useState(cwd);
  const [preflight, setPreflight] = useState<PreflightData | undefined>();
  const [configEdit, setConfigEdit] = useState<{config: SecFlowConfig; path?: string} | undefined>();
  const [savedRuns, setSavedRuns] = useState<SavedRunSummary[]>([]);
  const [historyTargetPath, setHistoryTargetPath] = useState(cwd);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [run, setRun] = useState<AuditRun | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [approvalRequest, setApprovalRequest] = useState<{preview: ContextPreview; resolve: (approved: boolean) => void} | undefined>();
  const [draftApprovalRequest, setDraftApprovalRequest] = useState<{findings: NormalizedFinding[]; resolve: (approved: boolean) => void} | undefined>();
  const [resultsView, setResultsView] = useState<ResultsView>('overview');
  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const [findingsPage, setFindingsPage] = useState(0);
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
      if (screen === 'config') setScreen('home');
      if (screen === 'history') setScreen('home');
      if (screen === 'preflight') setScreen('target');
      if (screen === 'results' || screen === 'error') setScreen('home');
      if (screen === 'running' || screen === 'context-approval' || screen === 'draft-approval') setScreen('confirm-exit');
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

  async function openConfigEditor(): Promise<void> {
    setError(undefined);
    setScreen('config-loading');
    try {
      setConfigEdit(await loadConfig(cwd));
      setScreen('config');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setScreen('error');
    }
  }

  async function openSavedRuns(rootPath = targetPath): Promise<void> {
    const requestedPath = rootPath.trim() || cwd;
    setError(undefined);
    setScreen('history-loading');
    try {
      setHistoryTargetPath(requestedPath);
      setSavedRuns(await listSavedRuns(requestedPath));
      setScreen('history');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setScreen('error');
    }
  }

  async function applyHistoryAction(action: HistoryAction): Promise<void> {
    if (action === 'home') {
      setScreen('home');
      return;
    }
    if (action === 'quit') {
      exit();
      return;
    }
    setError(undefined);
    setScreen('history-loading');
    try {
      const loadedRun = await loadSavedRun(historyTargetPath, action.slice('run:'.length));
      setTargetPath(loadedRun.targetPath);
      setRun(loadedRun);
      setEvents([]);
      setResultsView('overview');
      setSelectedFindingIndex(0);
      setFindingsPage(0);
      setScreen('results');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setScreen('error');
    }
  }

  async function applyConfigAction(action: ConfigAction): Promise<void> {
    if (action === 'home') {
      setScreen('home');
      return;
    }
    if (action === 'quit') {
      exit();
      return;
    }
    setError(undefined);
    setScreen('config-loading');
    try {
      const saved = await updateConfig(cwd, (config) => applyConfigUpdate(config, action));
      setConfigEdit(saved);
      if (preflight) {
        setPreflight(await loadPreflight(cwd, targetPath));
      }
      setScreen('config');
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
    setDraftApprovalRequest(undefined);
    setResultsView('overview');
    setSelectedFindingIndex(0);
    setFindingsPage(0);
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
          }),
        approveRemediationDraft: (findings) =>
          new Promise<boolean>((resolve) => {
            setDraftApprovalRequest({findings, resolve});
            setScreen('draft-approval');
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
      setDraftApprovalRequest(undefined);
    }
  }

  function resolveApproval(approved: boolean): void {
    approvalRequest?.resolve(approved);
    setApprovalRequest(undefined);
    setScreen('running');
  }

  function resolveDraftApproval(approved: boolean): void {
    draftApprovalRequest?.resolve(approved);
    setDraftApprovalRequest(undefined);
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
        {screen === 'home' && <HomeScreen initialIndex={selectionIndexes.home ?? 0} onSelect={(action) => handleHomeAction(action, openConfigEditor, openSavedRuns, setScreen, exit)} />}
        {screen === 'commands' && <CommandsScreen />}
        {screen === 'config-loading' && <LoadingScreen label="Loading configuration..." />}
        {screen === 'config' && configEdit && <ConfigScreen config={configEdit.config} configPath={configEdit.path} initialIndex={selectionIndexes.config ?? 0} onSelect={(action) => void applyConfigAction(action)} />}
        {screen === 'history-loading' && <LoadingScreen label="Loading saved runs..." />}
        {screen === 'history' && <SavedRunsScreen targetPath={historyTargetPath} runs={savedRuns} initialIndex={selectionIndexes.history ?? 0} onSelect={(action) => void applyHistoryAction(action)} />}
        {screen === 'target' && <TargetScreen value={targetPath} onChange={setTargetPath} onSubmit={preparePreflight} />}
        {screen === 'preflight-loading' && <LoadingScreen label="Checking config, tools, and runtimes..." />}
        {screen === 'preflight' && preflight && <PreflightScreen data={preflight} initialIndex={selectionIndexes.preflight ?? 0} onSelect={(action) => handlePreflightAction(action, startAudit, () => openSavedRuns(preflight.targetPath), setScreen, exit)} />}
        {screen === 'running' && <RunningScreen events={events} />}
        {screen === 'context-approval' && approvalRequest && <ContextApprovalScreen events={events} preview={approvalRequest.preview} initialIndex={selectionIndexes['context-approval'] ?? 0} onSelect={resolveApproval} />}
        {screen === 'draft-approval' && draftApprovalRequest && <DraftApprovalScreen events={events} findings={draftApprovalRequest.findings} initialIndex={selectionIndexes['draft-approval'] ?? 0} onSelect={resolveDraftApproval} />}
        {screen === 'results' && run && (
          <ResultsScreen
            events={events}
            run={run}
            view={resultsView}
            selectedFindingIndex={selectedFindingIndex}
            findingsPage={findingsPage}
            initialIndex={selectionIndexes.results ?? 0}
            onSelect={(action) => {
              if (action === 'home') setScreen('home');
              else if (action === 'quit') exit();
              else if (isFindingAction(action)) {
                setSelectedFindingIndex(Number(action.slice('finding:'.length)));
                setResultsView('finding-detail');
                setSelectionIndexes((current) => ({...current, results: 0}));
              }
              else if (isFindingsPageAction(action)) {
                setFindingsPage(Number(action.slice('findings-page:'.length)));
                setResultsView('findings');
                setSelectionIndexes((current) => ({...current, results: 0}));
              }
              else {
                if (action === 'findings') {
                  setFindingsPage(0);
                }
                setResultsView(action);
                setSelectionIndexes((current) => ({...current, results: 0}));
              }
            }}
          />
        )}
        {screen === 'error' && <ErrorScreen message={error ?? 'Unknown error'} />}
        {screen === 'confirm-exit' && (
          <ConfirmExitScreen
            initialIndex={selectionIndexes['confirm-exit'] ?? 0}
            onSelect={(action) =>
              handleExitConfirmation(action, approvalRequest?.resolve ?? draftApprovalRequest?.resolve, approvalRequest ? 'context-approval' : draftApprovalRequest ? 'draft-approval' : 'running', setScreen, exit)
            }
          />
        )}
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
            {label: 'Load previous run for current directory', value: 'history'},
            {label: 'Edit config', value: 'config'},
            {label: 'View command reference', value: 'commands'},
            {label: 'Quit', value: 'quit'}
          ]}
          onSelect={(item) => onSelect(item.value)}
        />
      </Section>
    </>
  );
}

export function SavedRunsScreen({
  targetPath,
  runs,
  onSelect,
  initialIndex = 0
}: {
  targetPath: string;
  runs: SavedRunSummary[];
  onSelect: (action: HistoryAction) => void;
  initialIndex?: number;
}): React.ReactElement {
  const terminal = useTerminalSize();
  const visibleRuns = runs.slice(0, terminal.compact ? 8 : 15);
  const items: Array<{label: string; value: HistoryAction}> = [
    ...visibleRuns.map((run) => ({
      label: fitText(
        `${run.findingCount} total / ${run.scannerFindingCount} scan / ${run.businessFindingCount} biz | ${formatHistoryDate(run.updatedAt)} | ${run.caseId}`,
        terminal.columns - 6
      ),
      value: `run:${run.caseId}` as const
    })),
    {label: 'Back home', value: 'home'},
    {label: 'Quit', value: 'quit'}
  ];
  return (
    <>
      <Section title="Saved Runs">
        <StatusRow label="Target" value={targetPath} />
        <StatusRow label="Runs" value={runs.length} color={runs.length > 0 ? theme.success : theme.warning} />
        {runs.length === 0 ? <Text color={theme.muted}>No saved SecFlow cases were found for this target.</Text> : null}
        {runs.length > visibleRuns.length ? <Text color={theme.muted}>Showing {visibleRuns.length} most recent runs.</Text> : null}
      </Section>
      <Section title="Open Run">
        <SelectInput<HistoryAction>
          key={`history-${runs.map((run) => run.caseId).join('-')}-${initialIndex}`}
          initialIndex={Math.min(initialIndex, items.length - 1)}
          items={items}
          onSelect={(item) => onSelect(item.value)}
        />
      </Section>
    </>
  );
}

export function ConfigScreen({config, configPath, onSelect, initialIndex = 0}: {config: SecFlowConfig; configPath?: string; onSelect: (action: ConfigAction) => void; initialIndex?: number}): React.ReactElement {
  const providerItems = Object.entries(config.providers).map(([name, provider]) => ({
    label: `${config.defaultRuntime === name ? 'Current' : 'Use'} ${name} (${provider.kind}, ${provider.enabled ? 'enabled' : 'disabled'})`,
    value: `use-runtime:${name}` as const
  }));
  const items: Array<{label: string; value: ConfigAction}> = [
    ...providerItems,
    {label: 'Disable LLM runtime', value: 'disable-runtime'},
    {label: `${config.context.requireApproval ? 'Disable' : 'Require'} context approval`, value: 'toggle-context-approval'},
    {label: `${config.runtime.streamEvents ? 'Disable' : 'Enable'} LLM runtime event streaming`, value: 'toggle-runtime-events'},
    {label: 'Back home', value: 'home'},
    {label: 'Quit', value: 'quit'}
  ];
  return (
    <>
      <Section title="Config">
        <StatusRow label="File" value={configPath ?? '.secflow/config.yaml will be created on save'} />
        <StatusRow label="Default runtime" value={config.defaultRuntime ?? 'none'} color={config.defaultRuntime ? theme.success : theme.warning} />
        <StatusRow label="Context approval" value={config.context.requireApproval ? 'required' : 'not required'} />
        <StatusRow label="Runtime events" value={config.runtime.streamEvents ? 'streamed' : 'not streamed'} />
      </Section>
      <Section title="Edit Config">
        <SelectInput<ConfigAction>
          key={`config-${config.defaultRuntime ?? 'none'}-${String(config.context.requireApproval)}-${initialIndex}`}
          initialIndex={Math.min(initialIndex, items.length - 1)}
          items={items}
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
      <Text>secflow audit . --approve-context --approve-remediation-drafts</Text>
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
            {label: 'Load previous run for this target', value: 'history'},
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

export function DraftApprovalScreen({events = [], findings, onSelect, initialIndex = 0}: {events?: AuditEvent[]; findings: NormalizedFinding[]; onSelect: (approved: boolean) => void; initialIndex?: number}): React.ReactElement {
  const draftable = findings.slice(0, 5);
  return (
    <>
      <ProgressRail events={events} />
      <Section title="Patch Draft Approval">
        <StatusRow label="Draftable findings" value={draftable.length} color={draftable.length > 0 ? theme.warning : theme.success} />
        {draftable.map((finding) => (
          <Text key={finding.id}>{fitText(`${finding.severity.toUpperCase()} ${finding.title}`, 88)}</Text>
        ))}
      </Section>
      <Section title="Decision">
        <SelectInput<ApprovalAction>
          key={`draft-approval-${initialIndex}`}
          initialIndex={initialIndex}
          items={[
            {label: 'Generate patch draft artifacts', value: 'approve'},
            {label: 'Skip patch draft artifacts', value: 'skip'}
          ]}
          onSelect={(item) => onSelect(item.value === 'approve')}
        />
      </Section>
    </>
  );
}

export function ResultsScreen({
  run,
  onSelect,
  events = [],
  view = 'overview',
  selectedFindingIndex = 0,
  findingsPage = 0,
  initialIndex = 0
}: {
  run: AuditRun;
  onSelect: (action: ResultsAction) => void;
  events?: AuditEvent[];
  view?: ResultsView;
  selectedFindingIndex?: number;
  findingsPage?: number;
  initialIndex?: number;
}): React.ReactElement {
  const scannerFindings = run.findings.filter((finding) => finding.source !== 'business-logic');
  const businessFindings = run.findings.filter((finding) => finding.source === 'business-logic');
  const findings = [...businessFindings, ...scannerFindings];
  const selectedFinding = findings[Math.min(selectedFindingIndex, Math.max(0, findings.length - 1))];
  const actions = resultActions(view, findings);
  return (
    <>
      {view === 'overview' ? <ResultsSummary run={run} /> : null}
      {view === 'analysis' ? (
        <>
          <RepoMapSummary run={run} />
          <WorkflowSummary run={run} />
          <ToolOutcomeSummary results={run.toolResults} />
          <LlmActivitySummary run={run} />
          <LlmRuntimeEventsSummary events={run.llmEvents ?? events.filter((event) => event.type === 'llm:runtime-event').map((event) => event.event)} />
        </>
      ) : null}
      {view === 'reports' ? <ReportArtifactsSummary run={run} /> : null}
      {view === 'findings' ? <FindingsMenu businessFindings={businessFindings} scannerFindings={scannerFindings} page={findingsPage} onSelect={onSelect} /> : null}
      {view === 'finding-detail' && selectedFinding ? <FindingDetail finding={selectedFinding} reportPath={run.jsonReportPath ?? run.reportPath} /> : null}
      {view === 'drafts' ? <RemediationSummary drafts={run.remediationDrafts ?? []} /> : null}
      {view === 'findings' ? null : (
        <Section title="Report Actions">
          <SelectInput<ResultsAction>
            key={`results-${view}-${initialIndex}`}
            initialIndex={Math.min(initialIndex, actions.length - 1)}
            items={actions}
            onSelect={(item) => onSelect(item.value)}
          />
        </Section>
      )}
    </>
  );
}

function resultActions(view: ResultsView, findings: AuditRun['findings']): Array<{label: string; value: ResultsAction}> {
  const actions: Array<{label: string; value: ResultsAction}> =
    view === 'overview'
      ? [
          {label: 'Review analysis context', value: 'analysis'},
          {label: 'Review report artifacts', value: 'reports'},
          {label: `Review findings (${findings.length})`, value: 'findings'},
          {label: 'Review patch drafts', value: 'drafts'}
        ]
      : view === 'finding-detail'
        ? [{label: 'Back to findings', value: 'findings'}]
      : [{label: 'Back to overview', value: 'overview'}];
  return [...actions, {label: 'Back home', value: 'home'}, {label: 'Quit', value: 'quit'}];
}

function isFindingAction(action: ResultsAction): action is `finding:${number}` {
  return action.startsWith('finding:');
}

function isFindingsPageAction(action: ResultsAction): action is `findings-page:${number}` {
  return action.startsWith('findings-page:');
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
  if (screen === 'config') return 'Enter applies the highlighted config change. Esc returns home. q quits.';
  if (screen === 'history') return 'Enter opens a saved run. Esc returns home. q quits.';
  if (screen === 'target') return 'Enter confirms the target. Esc returns home. q quits.';
  if (screen === 'preflight') return 'Enter starts or changes direction. Esc edits target. q quits.';
  if (screen === 'running') return 'Audit is running. q asks before exiting.';
  if (screen === 'context-approval') return 'Review the preview path, then approve or skip. q asks before exiting.';
  if (screen === 'draft-approval') return 'Approve to generate reviewable patch draft artifacts. q asks before exiting.';
  if (screen === 'results') return 'Enter selects a report action. Esc returns home. q quits.';
  if (screen === 'confirm-exit') return 'Enter confirms the highlighted choice.';
  return 'Esc backs out where available. q quits.';
}

function handleHomeAction(action: HomeAction, openConfigEditor: () => void, openSavedRuns: () => void, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'start') setScreen('target');
  if (action === 'history') void openSavedRuns();
  if (action === 'config') void openConfigEditor();
  if (action === 'commands') setScreen('commands');
  if (action === 'quit') exit();
}

export function applyConfigUpdate(config: SecFlowConfig, action: ConfigAction): SecFlowConfig {
  if (action === 'toggle-context-approval') {
    return {
      ...config,
      context: {
        ...config.context,
        requireApproval: !config.context.requireApproval
      }
    };
  }
  if (action === 'toggle-runtime-events') {
    return {
      ...config,
      runtime: {
        ...config.runtime,
        streamEvents: !config.runtime.streamEvents
      }
    };
  }
  if (action === 'disable-runtime') {
    return {
      ...config,
      defaultRuntime: undefined
    };
  }
  if (action.startsWith('use-runtime:')) {
    const runtime = action.slice('use-runtime:'.length);
    const provider = config.providers[runtime];
    if (!provider) {
      return config;
    }
    return {
      ...config,
      defaultRuntime: runtime,
      providers: {
        ...config.providers,
        [runtime]: {
          ...provider,
          enabled: true
        }
      },
      modelProfiles: {
        ...config.modelProfiles,
        default: {
          ...(config.modelProfiles.default ?? {provider: runtime, model: provider.defaultModel ?? 'default'}),
          provider: runtime,
          model: provider.defaultModel ?? config.modelProfiles.default?.model ?? 'default'
        }
      }
    };
  }
  return config;
}

function handlePreflightAction(action: PreflightAction, startAudit: () => void, openSavedRuns: () => void, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'run') void startAudit();
  if (action === 'history') void openSavedRuns();
  if (action === 'back') setScreen('target');
  if (action === 'quit') exit();
}

function handleExitConfirmation(action: ConfirmExitAction, resolveApproval: ((approved: boolean) => void) | undefined, returnScreen: Screen, setScreen: (screen: Screen) => void, exit: () => void): void {
  if (action === 'stay') {
    setScreen(returnScreen);
    return;
  }
  resolveApproval?.(false);
  exit();
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function advanceSelection(screen: Screen, setSelectionIndexes: React.Dispatch<React.SetStateAction<Record<string, number>>>): void {
  const limits: Partial<Record<Screen, number>> = {
    home: 5,
    config: 9,
    preflight: 4,
    'context-approval': 2,
    'draft-approval': 2,
    results: 5,
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
