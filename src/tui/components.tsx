// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import {Box, Text} from 'ink';
import SelectInput from 'ink-select-input';
import type {AuditEvent, AuditRun, AuditStep, ContextPreview, LlmRuntimeEvent, NormalizedFinding, ToolRunResult} from '../core/types.js';
import type {PreflightData} from './preflight.js';
import {fitText, sectionContentWidth, useTerminalSize, valueWidth} from './layout.js';
import {severityColor, sourceColor, sourceLabel, statusColor, theme} from './theme.js';

export function Section({title, children}: {title: string; children: React.ReactNode}): React.ReactElement {
  const terminal = useTerminalSize();
  const framed = !terminal.compact;
  const titleText = framed ? title : `[${title}]`;
  return (
    <Box
      flexDirection="column"
      borderStyle={framed ? 'round' : undefined}
      borderColor={framed ? theme.border : undefined}
      paddingX={framed ? 1 : 0}
      marginBottom={terminal.spacious ? 1 : 0}
    >
      <Text bold color={theme.brand}>
        {titleText}
      </Text>
      {children}
    </Box>
  );
}

export function StatusRow({label, value, color = 'white'}: {label: string; value: string | number; color?: string}): React.ReactElement {
  const terminal = useTerminalSize();
  const text = fitText(String(value), valueWidth(terminal.columns, label.length, !terminal.compact));
  return (
    <Text>
      <Text color={theme.muted}>{label}: </Text>
      <Text color={color}>{text}</Text>
    </Text>
  );
}

export function Badge({label, color = theme.muted}: {label: string; color?: string}): React.ReactElement {
  return <Text color={color}>[{label}]</Text>;
}

export function StatusBadge({status}: {status: 'done' | 'running' | 'pending' | 'skipped' | 'error' | 'missing' | 'available'}): React.ReactElement {
  return <Badge label={status.toUpperCase()} color={statusColor(status)} />;
}

export function SeverityBadge({severity}: {severity: NormalizedFinding['severity']}): React.ReactElement {
  return <Badge label={severity.toUpperCase()} color={severityColor(severity)} />;
}

export function SourceBadge({source}: {source: NormalizedFinding['source']}): React.ReactElement {
  return <Badge label={sourceLabel(source)} color={sourceColor(source)} />;
}

export function PreflightSummary({data}: {data: PreflightData}): React.ReactElement {
  const terminal = useTerminalSize();
  const visibleTooling = terminal.compact ? data.tooling.slice(0, 4) : data.tooling;
  const visibleRuntimes = terminal.compact ? data.runtimes.slice(0, 2) : data.runtimes;
  const visibleWarnings = terminal.compact ? data.warnings.slice(0, 1) : data.warnings;
  return (
    <>
      <Section title="Preflight">
        <StatusRow label="Target" value={data.targetPath} />
        <StatusRow label="Config" value={data.configPath ?? 'built-in defaults'} />
        <StatusRow label="Default runtime" value={data.defaultRuntime ?? 'none'} color={data.defaultRuntime ? theme.success : theme.warning} />
        <StatusRow label="Context approval" value={data.config.context.requireApproval ? 'required' : 'not required'} />
      </Section>
      <Section title="Tools and Runtimes">
        {visibleTooling.map((row) => {
          const missingEnabled = row.enabled && !row.available;
          const line = `${row.name}: ${row.enabled ? 'enabled' : 'disabled'} / ${row.command}${missingEnabled ? ' / install or disable in config' : ''}`;
          return (
            <Text key={row.name}>
              <StatusBadge status={row.available ? 'available' : 'missing'} /> {fitText(line, terminal.columns - 12)}
            </Text>
          );
        })}
        {data.tooling.length > visibleTooling.length ? <Text color={theme.muted}>+ {data.tooling.length - visibleTooling.length} more tools</Text> : null}
        {visibleRuntimes.map((row) => (
          <Text key={row.name}>
            <StatusBadge status={row.enabled ? 'available' : 'pending'} /> {fitText(`${row.name}: ${row.kind} / ${row.model ?? 'default'}`, terminal.columns - 12)}
          </Text>
        ))}
        {data.runtimes.length > visibleRuntimes.length ? <Text color={theme.muted}>+ {data.runtimes.length - visibleRuntimes.length} more runtimes</Text> : null}
      </Section>
      {visibleWarnings.length > 0 && (
        <Section title="Warnings">
          {visibleWarnings.map((warning) => (
            <Text key={warning} color={theme.warning}>
              {fitText(warning, terminal.columns)}
            </Text>
          ))}
          {data.warnings.length > visibleWarnings.length ? <Text color={theme.muted}>+ {data.warnings.length - visibleWarnings.length} more warnings</Text> : null}
        </Section>
      )}
    </>
  );
}

export function EventLog({events}: {events: AuditEvent[]}): React.ReactElement {
  const terminal = useTerminalSize();
  const visible = events.slice(terminal.compact ? -5 : -10);
  return (
    <Section title="Run Progress">
      {visible.length === 0 ? (
        <Text color={theme.muted}>Waiting to start...</Text>
      ) : (
        visible.map((event, index) => <Text key={`${event.timestamp}-${index}`}>{fitText(renderEvent(event), terminal.columns)}</Text>)
      )}
    </Section>
  );
}

export function ContextApprovalSummary({preview}: {preview: ContextPreview}): React.ReactElement {
  return (
    <Section title="LLM Context Approval">
      <StatusRow label="Runtime" value={preview.runtime} />
      <StatusRow label="Prompt" value={preview.promptId} />
      <StatusRow label="Context size" value={`${preview.sizeBytes} / ${preview.maxBytes} bytes`} color={preview.sizeBytes <= preview.maxBytes ? theme.success : theme.danger} />
      <StatusRow label="Redaction rules" value={preview.redactionPatternCount} />
      <StatusRow label="Preview file" value={preview.contextPath} />
    </Section>
  );
}

export function ResultsSummary({run}: {run: AuditRun}): React.ReactElement {
  const scannerFindings = run.findings.filter((finding) => finding.source !== 'business-logic');
  const businessFindings = run.findings.filter((finding) => finding.source === 'business-logic');

  return (
    <Section title="Results">
      <StatusRow label="Run" value={run.runId} />
      <StatusRow label="Case" value={run.caseId ?? run.runId} />
      <StatusRow label="Files" value={run.profile.fileCount} />
      <StatusRow label="Business hypotheses" value={businessFindings.length} color={businessFindings.length > 0 ? theme.warning : theme.success} />
      <StatusRow label="Scanner findings" value={scannerFindings.length} color={scannerFindings.length > 0 ? theme.warning : theme.success} />
      <StatusRow label="LLM runtime" value={run.llmResponses.length > 0 ? 'invoked' : 'not invoked'} />
      <StatusRow label="Patch drafts" value={run.remediationDrafts?.length ?? 0} />
    </Section>
  );
}

export function ReportArtifactsSummary({run}: {run: AuditRun}): React.ReactElement {
  return (
    <Section title="Report Artifacts">
      <StatusRow label="Markdown" value={run.reportPath} />
      <StatusRow label="JSON" value={run.jsonReportPath ?? 'not written'} />
      <StatusRow label="SARIF" value={run.sarifPath} />
      <StatusRow label="Case file" value={caseFilePath(run)} />
      <StatusRow label="Patch drafts" value={run.remediationDrafts?.length ? patchDraftDirectory(run) : 'not generated'} />
    </Section>
  );
}

export function RepoMapSummary({run}: {run: AuditRun}): React.ReactElement {
  const frameworks = run.repoMap?.frameworks ?? run.profile.likelyFrameworks;
  const directories = run.repoMap?.notableDirectories ?? run.profile.notableDirectories;
  const samples = run.repoMap?.sampledFiles ?? run.profile.sampledFiles;
  return (
    <Section title="Repo Map">
      <StatusRow label="Frameworks" value={frameworks.length > 0 ? frameworks.join(', ') : 'none detected'} />
      <StatusRow label="Directories" value={directories.length > 0 ? directories.join(', ') : 'none detected'} />
      <StatusRow label="Samples" value={samples.length} />
    </Section>
  );
}

export function WorkflowSummary({run}: {run: AuditRun}): React.ReactElement {
  return (
    <Section title="Workflows">
      <StatusRow label="Actors" value={run.business.actors.length > 0 ? run.business.actors.join(', ') : 'none detected'} />
      <StatusRow label="Entry points" value={run.business.entryPoints.length > 0 ? run.business.entryPoints.join(', ') : 'none detected'} />
      <StatusRow label="Review questions" value={run.business.reviewQuestions.length} />
    </Section>
  );
}

export function RemediationSummary({drafts}: {drafts: NonNullable<AuditRun['remediationDrafts']>}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  return (
    <Section title="Remediation Drafts">
      {drafts.length === 0 ? (
        <Text color={theme.muted}>No patch drafts were generated.</Text>
      ) : (
        drafts.slice(0, 5).map((draft) => <Text key={draft.id}>{fitText(`${draft.title}: ${draft.artifactPath ?? draft.status}`, width)}</Text>)
      )}
    </Section>
  );
}

export function LlmActivitySummary({run}: {run: AuditRun}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  return (
    <Section title="LLM Activity">
      {run.llmResponses.length === 0 ? (
        <Text color={theme.muted}>No LLM runtime responses were recorded.</Text>
      ) : (
        run.llmResponses.slice(0, 4).map((response, index) => (
          <Text key={`${response.runtime}-${index}`}>{fitText(`${response.runtime}${response.model ? `/${response.model}` : ''}: ${response.text.replace(/\s+/g, ' ').trim()}`, width)}</Text>
        ))
      )}
    </Section>
  );
}

export function LlmRuntimeEventsSummary({events}: {events: LlmRuntimeEvent[]}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  const visible = events.slice(terminal.compact ? -5 : -10);
  return (
    <Section title="LLM Runtime Events">
      {visible.length === 0 ? (
        <Text color={theme.muted}>Runtime event streaming is disabled or no events were recorded.</Text>
      ) : (
        visible.map((event, index) => (
          <Text key={`${event.timestamp}-${index}`}>
            {fitText(`${event.runtime}/${event.taskId} ${event.type}: ${event.message.replace(/\s+/g, ' ').trim()}`, width)}
          </Text>
        ))
      )}
    </Section>
  );
}

export function FindingSummary({title, findings}: {title: string; findings: NormalizedFinding[]}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  return (
    <Section title={title}>
      {findings.length === 0 ? (
        <Text color={theme.muted}>No findings in this category.</Text>
      ) : (
        findings.slice(0, 5).map((finding) => (
          <Text key={finding.id}>
            <SeverityBadge severity={finding.severity} /> <SourceBadge source={finding.source} /> {fitText(finding.title, width - 24)}
          </Text>
        ))
      )}
    </Section>
  );
}

type FindingAction = `finding:${number}` | `findings-page:${number}` | 'overview' | 'home' | 'quit';

export function FindingsMenu({
  businessFindings,
  scannerFindings,
  page = 0,
  onSelect
}: {
  businessFindings: NormalizedFinding[];
  scannerFindings: NormalizedFinding[];
  page?: number;
  onSelect: (action: FindingAction) => void;
}): React.ReactElement {
  const terminal = useTerminalSize();
  const findings = [...businessFindings, ...scannerFindings];
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  const pageSize = terminal.compact ? 12 : 18;
  const pageCount = Math.max(1, Math.ceil(findings.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const start = currentPage * pageSize;
  const visibleFindings = findings.slice(start, start + pageSize);
  const items: Array<{label: string; value: FindingAction}> = [
    ...visibleFindings.map((finding, index) => ({
      label: fitText(`${String(start + index + 1).padStart(3, ' ')} ${finding.severity.toUpperCase()} ${sourceLabel(finding.source)} ${finding.title}`, width - 4),
      value: `finding:${start + index}` as const
    })),
    ...(currentPage > 0 ? [{label: `Previous page (${currentPage}/${pageCount})`, value: `findings-page:${currentPage - 1}` as const}] : []),
    ...(currentPage < pageCount - 1 ? [{label: `Next page (${currentPage + 2}/${pageCount})`, value: `findings-page:${currentPage + 1}` as const}] : []),
    {label: 'Back to overview', value: 'overview'},
    {label: 'Back home', value: 'home'},
    {label: 'Quit', value: 'quit'}
  ];
  return (
    <Section title="Select Finding">
      <Text color={theme.muted}>
        {findings.length} findings · page {currentPage + 1}/{pageCount} · business {businessFindings.length} · scanner {scannerFindings.length}
      </Text>
      {findings.length === 0 ? <Text color={theme.muted}>No findings were produced.</Text> : null}
      <SelectInput<FindingAction> key={`findings-${currentPage}-${findings.length}`} items={items} onSelect={(item) => onSelect(item.value)} />
    </Section>
  );
}

export function FindingDetail({finding, reportPath}: {finding: NormalizedFinding; reportPath: string}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  const lines = terminal.compact
    ? compactFindingDetailLines(finding, reportPath).map((line) => fitText(line, width))
    : findingDetailLines(finding, reportPath).flatMap((line) => wrapDetailLine(line, width));
  return (
    <Section title="Finding Detail">
      {lines.map((line, index) => (
        <Text key={`finding-detail-${index}`}>{line}</Text>
      ))}
    </Section>
  );
}

export function ToolOutcomeSummary({results}: {results: ToolRunResult[]}): React.ReactElement {
  const terminal = useTerminalSize();
  const width = sectionContentWidth(terminal.columns, !terminal.compact);
  return (
    <Section title="Tool Outcomes">
      {results.length === 0 ? (
        <Text color={theme.muted}>No tool results.</Text>
      ) : (
        results.map((result) => (
          <Text key={result.tool}>
            <StatusBadge status={result.available ? (result.skipped ? 'skipped' : 'done') : 'missing'} /> {fitText(`${result.tool}: ${result.findings.length} findings`, width - 11)}
          </Text>
        ))
      )}
    </Section>
  );
}

export function ProgressRail({events}: {events: AuditEvent[]}): React.ReactElement {
  const terminal = useTerminalSize();
  const steps: Array<{step: AuditStep; label: string}> = [
    {step: 'profile', label: 'Profile'},
    {step: 'repo-map', label: terminal.narrow ? 'Map' : 'Repo Map'},
    {step: 'business-workflows', label: terminal.narrow ? 'Biz' : 'Business Logic'},
    {step: 'tools', label: 'Tools'},
    {step: 'finding-normalization', label: terminal.narrow ? 'Find' : 'Findings'},
    {step: 'llm', label: terminal.narrow ? 'LLM' : 'LLM Review'},
    {step: 'remediation-drafting', label: terminal.narrow ? 'Fix' : 'Patch Drafts'},
    {step: 'reports', label: 'Reports'}
  ];
  if (terminal.compact) {
    const firstRow = steps.slice(0, 4).map((step) => compactStep(stepStatus(events, step.step), step.label)).join('  ');
    const secondRow = steps.slice(4).map((step) => compactStep(stepStatus(events, step.step), step.label)).join('  ');
    return (
      <Section title="Audit Steps">
        <Text>{fitText(firstRow, sectionContentWidth(terminal.columns, false))}</Text>
        <Text>{fitText(secondRow, sectionContentWidth(terminal.columns, false))}</Text>
      </Section>
    );
  }
  return (
    <Section title="Audit Steps">
      {steps.map((step) => (
        <Text key={step.step}>
          <StatusBadge status={stepStatus(events, step.step)} /> {step.label}
        </Text>
      ))}
    </Section>
  );
}

function compactStep(status: ReturnType<typeof stepStatus>, label: string): string {
  const marker = status === 'done' ? '✓' : status === 'running' ? '…' : status === 'skipped' ? '-' : status === 'error' ? '!' : '·';
  return `${marker} ${label}`;
}

function renderEvent(event: AuditEvent): string {
  if (event.type === 'llm:runtime-event') {
    return `${event.event.runtime}/${event.event.taskId}: ${event.event.message}`;
  }
  if (event.type === 'tool:complete') {
    return `${event.result.tool}: ${event.result.skipped ? 'skipped' : 'completed'} (${event.result.findings.length} findings)`;
  }
  if (event.type === 'context:preview') {
    return `Context preview ready for ${event.preview.runtime}: ${event.preview.sizeBytes} bytes`;
  }
  if (event.type === 'llm:skipped') {
    return `LLM skipped: ${event.reason}`;
  }
  if (event.type === 'run:complete') {
    return `Run complete: ${event.run.findings.length} findings`;
  }
  if (event.type === 'error') {
    return `Error: ${event.message}`;
  }
  return event.message;
}

function stepStatus(events: AuditEvent[], step: AuditStep): 'done' | 'running' | 'pending' | 'skipped' | 'error' {
  if (events.some((event) => event.type === 'error')) {
    return 'error';
  }
  if (step === 'llm' && events.some((event) => event.type === 'llm:skipped')) {
    return 'skipped';
  }
  const matching = events.filter((event) => event.step === step);
  if (matching.some((event) => event.type === 'step:complete')) {
    return 'done';
  }
  if (matching.some((event) => event.type === 'step:start' || event.type === 'context:preview')) {
    return 'running';
  }
  if (step === 'llm' && events.some((event) => event.step === 'reports')) {
    return 'skipped';
  }
  return 'pending';
}

function friendlyToolMessage(result: ToolRunResult): string {
  if (!result.available) {
    return `${result.message} Install ${result.tool} or disable it in .secflow/config.yaml.`;
  }
  return result.message;
}

function caseFilePath(run: AuditRun): string {
  return `${run.runDir.replace(/\/artifacts$/, '')}/case.json`;
}

function patchDraftDirectory(run: AuditRun): string {
  const artifactPath = run.remediationDrafts?.find((draft) => draft.artifactPath)?.artifactPath;
  return artifactPath ? artifactPath.replace(/\/[^/]+$/, '') : `${run.runDir}/patch-drafts`;
}

function formatLocation(finding: NormalizedFinding): string {
  if (!finding.path) {
    return 'repository-wide';
  }
  return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

function analysisLines(finding: NormalizedFinding): string[] {
  return [
    `Recommendation: ${finding.recommendation}`,
    finding.exploitPath ? `Exploit path: ${finding.exploitPath}` : undefined,
    ...(finding.assumptions?.map((assumption) => `Assumption: ${assumption}`) ?? []),
    ...(finding.validationSteps?.map((step) => `Validation: ${step}`) ?? []),
    finding.metadata ? `Metadata keys: ${Object.keys(finding.metadata).join(', ') || 'none'}` : undefined
  ].filter((line): line is string => Boolean(line));
}

function findingDetailLines(finding: NormalizedFinding, reportPath: string): string[] {
  return [
    `Title: ${finding.title}`,
    `Source: ${sourceLabel(finding.source)}`,
    `Severity: ${finding.severity}`,
    `Confidence: ${Math.round(finding.confidence * 100)}%`,
    `Location: ${formatLocation(finding)}`,
    `CWE: ${finding.cwe?.join(', ') ?? 'none'}`,
    `Description: ${finding.description}`,
    'Evidence:',
    ...(finding.evidence.length > 0 ? finding.evidence.map((item) => `- ${item}`) : ['- No evidence recorded.']),
    'Analysis:',
    ...analysisLines(finding).map((line) => `- ${line}`),
    'References:',
    ...(finding.references?.length ? finding.references.map((reference) => `- ${reference}`) : [`- Full report JSON: ${reportPath}`])
  ];
}

function compactFindingDetailLines(finding: NormalizedFinding, reportPath: string): string[] {
  const evidence = finding.evidence.length > 0 ? finding.evidence.slice(0, 2) : ['No evidence recorded.'];
  const validation = finding.validationSteps?.slice(0, 2) ?? [];
  return [
    `Title: ${finding.title}`,
    `Severity: ${finding.severity} / Source: ${sourceLabel(finding.source)} / Confidence: ${Math.round(finding.confidence * 100)}%`,
    `Location: ${formatLocation(finding)}`,
    `Description: ${finding.description}`,
    'Evidence:',
    ...evidence.map((item) => `- ${item}`),
    finding.evidence.length > evidence.length ? `- ${finding.evidence.length - evidence.length} more evidence items in the JSON report.` : undefined,
    ...(finding.assumptions?.slice(0, 1).map((assumption) => `Assumption: ${assumption}`) ?? []),
    `Recommendation: ${finding.recommendation}`,
    finding.exploitPath ? `Exploit path: ${finding.exploitPath}` : undefined,
    ...validation.map((step) => `Validation: ${step}`),
    `Full details: ${reportPath}`
  ].filter((line): line is string => Boolean(line));
}

function wrapDetailLine(value: string, width: number): string[] {
  const maxWidth = Math.max(12, width);
  const continuation = value.startsWith('- ') ? '  ' : '';
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const prefix = lines.length === 0 ? '' : continuation;
    const candidate = current ? `${current} ${word}` : `${prefix}${word}`;
    if (candidate.length <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (word.length <= maxWidth - continuation.length) {
      current = `${continuation}${word}`;
      continue;
    }
    for (const chunk of chunkWord(word, maxWidth - continuation.length)) {
      lines.push(`${continuation}${chunk}`);
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function chunkWord(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

export function shorten(value: string, maxLength = 76): string {
  return fitText(value, maxLength);
}
