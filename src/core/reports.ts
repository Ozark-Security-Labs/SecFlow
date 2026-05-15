// SPDX-License-Identifier: AGPL-3.0-only
import type {AuditRun, BusinessWorkflowModel, NormalizedFinding, RemediationDraft, RepoProfile, ToolRunResult} from './types.js';

export function renderMarkdownReport(run: Omit<AuditRun, 'reportPath' | 'sarifPath'>): string {
  const scannerFindings = run.findings.filter((finding) => finding.source !== 'business-logic');
  const businessFindings = run.findings.filter((finding) => finding.source === 'business-logic');

  return [
    `# SecFlow Audit Report`,
    '',
    `Run ID: \`${run.runId}\``,
    `Target: \`${run.targetPath}\``,
    `Generated: \`${new Date().toISOString()}\``,
    '',
    '## Repository Profile',
    renderProfile(run.profile),
    '',
    '## Business Logic Analysis',
    renderBusinessModel(run.business),
    '',
    '## Scanner-Backed Findings',
    renderFindings(scannerFindings, 'No scanner-backed findings were produced. Missing or disabled tools are listed below.'),
    '',
    '## Business Logic Hypotheses',
    renderFindings(businessFindings, 'No business logic hypotheses were produced.'),
    '',
    '## Tool Runs',
    renderToolRuns(run.toolResults),
    '',
    '## Remediation Drafts',
    renderRemediationDrafts(run.remediationDrafts ?? []),
    '',
    '## LLM Runtime Activity',
    renderLlmResponses(run.llmResponses),
    '',
    '## LLM Runtime Events',
    renderLlmEvents(run.llmEvents ?? []),
    ''
  ].join('\n');
}

export function renderJsonReport(run: Omit<AuditRun, 'reportPath' | 'sarifPath'>): Record<string, unknown> {
  return {
    schema: 'secflow.audit-report.v1',
    runId: run.runId,
    caseId: run.caseId,
    targetPath: run.targetPath,
    generatedAt: new Date().toISOString(),
    repository: run.profile,
    repoMap: run.profile
      ? {
          manifests: run.profile.manifests,
          frameworks: run.profile.likelyFrameworks,
          notableDirectories: run.profile.notableDirectories,
          extensionSummary: run.profile.extensions,
          sampledFiles: run.profile.sampledFiles
        }
      : undefined,
    business: run.business,
    scannerFindings: run.findings.filter((finding) => finding.source !== 'business-logic'),
    businessLogicHypotheses: run.findings.filter((finding) => finding.source === 'business-logic'),
    toolResults: run.toolResults,
    llmResponses: run.llmResponses.map((response) => ({
      runtime: response.runtime,
      model: response.model,
      text: response.text,
      usage: response.usage
    })),
    llmEvents: run.llmEvents ?? [],
    remediationDrafts: run.remediationDrafts ?? []
  };
}

export function renderPatchDrafts(findings: NormalizedFinding[]): RemediationDraft[] {
  return findings.slice(0, 5).map((finding) => ({
    id: `patch-draft:${finding.id}`,
    findingId: finding.id,
    title: `Patch draft for ${finding.title}`,
    status: 'drafted',
    createdAt: new Date().toISOString(),
    summary: `Review and remediate ${finding.title}.`,
    patch: [
      `# Patch Draft: ${finding.title}`,
      '',
      `Finding: ${finding.id}`,
      finding.path ? `Location: ${finding.path}${finding.line ? `:${finding.line}` : ''}` : 'Location: repository-wide',
      '',
      '## Suggested Change',
      finding.recommendation,
      '',
      '## Validation',
      ...(finding.validationSteps?.length ? finding.validationSteps.map((step) => `- ${step}`) : ['- Add or update tests for the affected workflow.', '- Re-run the relevant scanner and application test suite.']),
      '',
      'No repository files were edited by SecFlow.'
    ].join('\n')
  }));
}

export function renderSarif(findings: NormalizedFinding[]): Record<string, unknown> {
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'SecFlow',
            informationUri: 'https://github.com/bjcorder/SecFlow',
            rules: findings.map((finding) => ({
              id: finding.id,
              name: finding.title,
              shortDescription: {text: finding.title},
              fullDescription: {text: finding.description},
              help: {text: finding.recommendation},
              properties: {
                source: finding.source,
                severity: finding.severity,
                confidence: finding.confidence,
                cwe: finding.cwe
              }
            }))
          }
        },
        results: findings.map((finding) => ({
          ruleId: finding.id,
          level: sarifLevel(finding.severity),
          message: {text: `${finding.description}\n\nRecommendation: ${finding.recommendation}`},
          locations: finding.path
            ? [
                {
                  physicalLocation: {
                    artifactLocation: {uri: finding.path},
                    region: finding.line ? {startLine: finding.line} : undefined
                  }
                }
              ]
            : []
        }))
      }
    ]
  };
}

function renderProfile(profile: RepoProfile): string {
  return [
    `- Files: ${profile.fileCount}`,
    `- Total bytes: ${profile.totalBytes}`,
    `- Likely frameworks: ${profile.likelyFrameworks.length > 0 ? profile.likelyFrameworks.join(', ') : 'none detected'}`,
    `- Manifests: ${profile.manifests.length > 0 ? profile.manifests.join(', ') : 'none detected'}`,
    `- Security-relevant files sampled: ${profile.securityRelevantFiles.length}`
  ].join('\n');
}

function renderBusinessModel(model: BusinessWorkflowModel): string {
  return [
    `- Actors: ${listOrNone(model.actors)}`,
    `- Roles/signals: ${listOrNone(model.roles)}`,
    `- Assets: ${listOrNone(model.assets)}`,
    `- Trust boundaries: ${listOrNone(model.trustBoundaries)}`,
    `- Entry points: ${listOrNone(model.entryPoints)}`,
    `- State transitions: ${listOrNone(model.stateTransitions)}`,
    '',
    'Review questions:',
    ...model.reviewQuestions.map((question) => `- ${question}`)
  ].join('\n');
}

function renderFindings(findings: NormalizedFinding[], empty: string): string {
  if (findings.length === 0) {
    return empty;
  }
  return findings
    .map((finding) =>
      [
        `### ${finding.title}`,
        '',
        `- Source: ${finding.source}`,
        `- Severity: ${finding.severity}`,
        `- Confidence: ${Math.round(finding.confidence * 100)}%`,
        finding.path ? `- Location: ${finding.path}${finding.line ? `:${finding.line}` : ''}` : undefined,
        `- Description: ${finding.description}`,
        finding.evidence.length > 0 ? `- Evidence: ${finding.evidence.join('; ')}` : undefined,
        finding.assumptions?.length ? `- Assumptions: ${finding.assumptions.join('; ')}` : undefined,
        finding.exploitPath ? `- Exploit path: ${finding.exploitPath}` : undefined,
        finding.validationSteps?.length ? `- Validation steps: ${finding.validationSteps.join('; ')}` : undefined,
        `- Recommendation: ${finding.recommendation}`
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
}

function renderRemediationDrafts(drafts: RemediationDraft[]): string {
  if (drafts.length === 0) {
    return 'No patch drafts were generated.';
  }
  return drafts.map((draft) => `- ${draft.title}: ${draft.artifactPath ?? draft.status}`).join('\n');
}

function renderLlmResponses(responses: AuditRun['llmResponses']): string {
  if (responses.length === 0) {
    return '- No LLM runtime was invoked. This can happen when no runtime is configured or context approval was not provided.';
  }
  return responses
    .map((response) =>
      [
        `### ${response.runtime}${response.model ? ` (${response.model})` : ''}`,
        '',
        truncate(response.text.trim(), 8000)
      ].join('\n')
    )
    .join('\n\n');
}

function renderLlmEvents(events: NonNullable<AuditRun['llmEvents']>): string {
  if (events.length === 0) {
    return '- No LLM runtime events were recorded.';
  }
  return events.slice(-20).map((event) => `- ${event.timestamp} ${event.runtime}/${event.taskId} ${event.type}: ${event.message}`).join('\n');
}

function renderToolRuns(results: ToolRunResult[]): string {
  if (results.length === 0) {
    return '- No tools were configured.';
  }
  return results
    .map((result) => `- ${result.tool}: ${result.skipped ? 'skipped' : 'ran'}; available=${result.available}; findings=${result.findings.length}; ${result.message}`)
    .join('\n');
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none detected';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}\n\n[LLM output truncated; see llm-responses.json for the full response.]`;
}

function sarifLevel(severity: NormalizedFinding['severity']): 'none' | 'note' | 'warning' | 'error' {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  if (severity === 'low') return 'note';
  return 'none';
}
