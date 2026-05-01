import React from 'react';
import {Box, Text} from 'ink';
import type {AuditEvent, AuditRun, AuditStep, ContextPreview, NormalizedFinding, ToolRunResult} from '../core/types.js';
import type {PreflightData} from './preflight.js';
import {fitText, useTerminalSize, valueWidth} from './layout.js';
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
  const text = fitText(String(value), valueWidth(terminal.columns, label.length));
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
  const terminal = useTerminalSize();
  const scannerFindings = run.findings.filter((finding) => finding.source !== 'business-logic');
  const businessFindings = run.findings.filter((finding) => finding.source === 'business-logic');
  const skippedTools = run.toolResults.filter((result) => result.skipped);
  const showDetails = !terminal.compact;

  return (
    <>
      <Section title="Results">
        <StatusRow label="Run" value={run.runId} />
        <StatusRow label="Files profiled" value={run.profile.fileCount} />
        <StatusRow label="Business hypotheses" value={businessFindings.length} color={businessFindings.length > 0 ? theme.warning : theme.success} />
        <StatusRow label="Scanner findings" value={scannerFindings.length} color={scannerFindings.length > 0 ? theme.warning : theme.success} />
        <StatusRow label="LLM runtime" value={run.llmResponses.length > 0 ? 'invoked' : 'not invoked'} />
        <StatusRow label="Report" value={run.reportPath} />
        <StatusRow label="SARIF" value={run.sarifPath} />
      </Section>
      {showDetails ? <FindingSummary title="Top Business Logic Items" findings={businessFindings} /> : null}
      {showDetails ? <ToolOutcomeSummary results={run.toolResults} /> : null}
      {showDetails && skippedTools.length > 0 && (
        <Section title="Skipped Tools">
          {skippedTools.map((result) => (
            <Text key={result.tool}>
              <StatusBadge status="skipped" /> {result.tool}: {friendlyToolMessage(result)}
            </Text>
          ))}
        </Section>
      )}
    </>
  );
}

export function FindingSummary({title, findings}: {title: string; findings: NormalizedFinding[]}): React.ReactElement {
  const terminal = useTerminalSize();
  return (
    <Section title={title}>
      {findings.length === 0 ? (
        <Text color={theme.muted}>No findings in this category.</Text>
      ) : (
        findings.slice(0, 5).map((finding) => (
          <Text key={finding.id}>
            <SeverityBadge severity={finding.severity} /> <SourceBadge source={finding.source} /> {fitText(finding.title, terminal.columns - 26)}
          </Text>
        ))
      )}
    </Section>
  );
}

export function ToolOutcomeSummary({results}: {results: ToolRunResult[]}): React.ReactElement {
  return (
    <Section title="Tool Outcomes">
      {results.length === 0 ? (
        <Text color={theme.muted}>No tool results.</Text>
      ) : (
        results.map((result) => (
          <Text key={result.tool}>
            <StatusBadge status={result.available ? (result.skipped ? 'skipped' : 'done') : 'missing'} /> {result.tool}: {result.findings.length} findings
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
    {step: 'business-workflows', label: terminal.narrow ? 'Biz' : 'Business Logic'},
    {step: 'tools', label: 'Tools'},
    {step: 'llm', label: terminal.narrow ? 'LLM' : 'LLM Review'},
    {step: 'reports', label: 'Reports'}
  ];
  return (
    <Section title="Audit Steps">
      <Text>
        {steps.map((step, index) => (
          <React.Fragment key={step.step}>
            <StatusBadge status={stepStatus(events, step.step)} /> {step.label}
            {index < steps.length - 1 ? <Text color={theme.muted}> -&gt; </Text> : null}
          </React.Fragment>
        ))}
      </Text>
    </Section>
  );
}

function renderEvent(event: AuditEvent): string {
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

export function shorten(value: string, maxLength = 76): string {
  return fitText(value, maxLength);
}
