// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {
  ApprovalKind,
  AuditEvent,
  AuditRun,
  AuditStep,
  CaseFile,
  ContextPreview,
  LlmResponse,
  LlmRuntimeEvent,
  LlmTask,
  NormalizedFinding,
  RemediationDraft,
  RepoMap,
  SecFlowConfig
} from './types.js';
import {extractBusinessWorkflowModel} from './business.js';
import {createCaseStore} from './caseStore.js';
import {buildContextPackage, contextSizeBytes, redactContext} from './context.js';
import {collectFindings} from './findings.js';
import {profileRepository, readSmallTextFile} from './profile.js';
import {PromptRegistry} from './prompts.js';
import {renderJsonReport, renderMarkdownReport, renderPatchDrafts, renderSarif} from './reports.js';
import {runWorkflow, type WorkflowStep} from './workflow.js';
import {runConfiguredTools} from '../tools/registry.js';
import {writeJson, writeText} from '../util/files.js';
import {invokeConfiguredRuntime} from '../llm/runtimeRegistry.js';
import {parseMaybeJson} from '../llm/adapter.js';
import {renderReportSynthesisMarkdown, reportSynthesisOutputJsonSchema, validateReportSynthesisOutput} from '../llm/synthesis.js';
import {validateWorkflowExtractionOutput, workflowExtractionOutputJsonSchema} from '../llm/workflowExtraction.js';

export interface AuditOptions {
  targetPath: string;
  config: SecFlowConfig;
  contextApproved?: boolean;
  approveContext?: (preview: ContextPreview) => boolean | Promise<boolean>;
  remediationDraftApproved?: boolean;
  approveRemediationDraft?: (findings: NormalizedFinding[]) => boolean | Promise<boolean>;
  onEvent?: (event: AuditEvent) => void;
  runtime?: string;
}

interface AuditContext {
  options: AuditOptions;
  targetPath: string;
  runId: string;
  runDir: string;
  store: ReturnType<typeof createCaseStore>;
  caseFile: CaseFile;
  profile?: AuditRun['profile'];
  repoMap?: RepoMap;
  business?: AuditRun['business'];
  toolResults: AuditRun['toolResults'];
  findings: NormalizedFinding[];
  llmResponses: LlmResponse[];
  llmEvents: LlmRuntimeEvent[];
  remediationDrafts: RemediationDraft[];
  reportPath?: string;
  jsonReportPath?: string;
  sarifPath?: string;
}

export async function runAudit(options: AuditOptions): Promise<AuditRun> {
  let context: AuditContext | undefined;
  try {
    const targetPath = path.resolve(options.targetPath);
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const store = createCaseStore(targetPath);
    const steps = buildAuditWorkflow();
    const caseFile = await store.create({
      caseId: runId,
      targetPath,
      workflow: steps.map((step) => ({
        id: step.id,
        title: step.title,
        dependencies: step.dependencies ?? [],
        approvalKind: step.approvalKind,
        state: 'pending',
        artifactIds: []
      }))
    });
    context = {
      options,
      targetPath,
      runId,
      runDir: path.join(targetPath, options.config.outputs.directory, 'cases', runId, 'artifacts'),
      store,
      caseFile,
      toolResults: [],
      findings: [],
      llmResponses: [],
      llmEvents: [],
      remediationDrafts: []
    };

    await emitCaseEvent(context, {type: 'step:start', step: 'initialize', message: `Preparing audit for ${targetPath}.`, timestamp: new Date().toISOString(), data: {runId, runDir: context.runDir}});
    await emitCaseEvent(context, {type: 'step:complete', step: 'initialize', message: 'Case file created.', timestamp: new Date().toISOString(), data: {caseId: runId}});

    const workflowResult = await runWorkflow(steps, context, {
      requestApproval: (kind) => resolveWorkflowApproval(context!, kind),
      onStepChange: async (step) => {
        context!.caseFile = await context!.store.save({
          ...context!.caseFile,
          workflow: context!.caseFile.workflow.map((record) => (record.id === step.id ? step : record))
        });
      }
    });
    context.caseFile = await context.store.save({...context.caseFile, workflow: workflowResult.steps, status: 'complete'});

    if (!context.profile || !context.business || !context.reportPath || !context.sarifPath) {
      throw new Error('Audit workflow completed without required report artifacts.');
    }

    const run: AuditRun = {
      runId,
      caseId: context.caseFile.caseId,
      targetPath,
      runDir: context.runDir,
      profile: context.profile,
      repoMap: context.repoMap,
      business: context.business,
      toolResults: context.toolResults,
      findings: context.findings,
      llmResponses: context.llmResponses,
      llmEvents: context.llmEvents,
      remediationDrafts: context.remediationDrafts,
      reportPath: context.reportPath,
      jsonReportPath: context.jsonReportPath,
      sarifPath: context.sarifPath
    };
    options.onEvent?.({type: 'run:complete', step: 'complete', timestamp: new Date().toISOString(), run});
    context.caseFile = await context.store.appendEvent(context.caseFile.caseId, {type: 'run:complete', step: 'complete', timestamp: new Date().toISOString(), run});
    return run;
  } catch (error) {
    if (context) {
      await context.store.save({...context.caseFile, status: 'failed'}).catch(() => undefined);
    }
    options.onEvent?.({
      type: 'error',
      step: 'error',
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      error
    });
    throw error;
  }
}

async function maybeInvokeLlm(
  options: AuditOptions,
  targetPath: string,
  profile: AuditRun['profile'],
  business: AuditRun['business'],
  findings: NormalizedFinding[],
  runDir: string,
  context?: AuditContext
): Promise<LlmResponse[]> {
  const responses: LlmResponse[] = [];
  const runtime = options.runtime ?? options.config.defaultRuntime;
  if (!runtime) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: 'No default runtime configured.'});
    await emitAuditEvent(options, context, {type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: 'No default runtime configured.'});
    return responses;
  }

  await emitAuditEvent(options, context, {type: 'step:start', step: 'context-preview', message: 'Building LLM context preview.', timestamp: new Date().toISOString()});
  const registry = await PromptRegistry.fromDirectory(targetPath, options.config.prompts.directory);
  registry.validateRequired(options.config.prompts.required);
  const contextPackage = redactContext(buildContextPackage(profile, business, findings), options.config.context.redactions);
  const size = contextSizeBytes(contextPackage);
  const contextPath = path.join(runDir, 'llm-context-preview.json');
  await writeJson(contextPath, {sizeBytes: size, context: contextPackage});
  const preview: ContextPreview = {
    runtime,
    promptId: 'report-synthesis',
    sizeBytes: size,
    maxBytes: options.config.context.maxBytes,
    requireApproval: options.config.context.requireApproval,
    redactionPatternCount: options.config.context.redactions.length,
    contextPath
  };
  options.onEvent?.({type: 'context:preview', step: 'context-preview', timestamp: new Date().toISOString(), preview});
  if (context) {
    context.caseFile = await context.store.appendEvent(context.caseFile.caseId, {type: 'context:preview', step: 'context-preview', timestamp: new Date().toISOString(), preview});
  }
  await emitAuditEvent(options, context, {type: 'step:complete', step: 'context-preview', message: `LLM context preview is ${size} bytes.`, timestamp: new Date().toISOString(), data: {sizeBytes: size, contextPath}});
  if (size > options.config.context.maxBytes) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`, sizeBytes: size});
    await emitAuditEvent(options, context, {
      type: 'llm:skipped',
      step: 'llm',
      timestamp: new Date().toISOString(),
      reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`
    });
    return responses;
  }

  const approved = await resolveContextApproval(options, preview);
  if (context) {
    context.caseFile = await context.store.save({
      ...context.caseFile,
      approvals: [
        ...context.caseFile.approvals,
        {
          id: `approval:llm-context:${Date.now()}`,
          kind: 'llm-context',
          requestedAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          approved,
          artifactPath: contextPath,
          reason: approved ? 'Approved for runtime invocation.' : 'Context approval was denied.'
        }
      ]
    });
  }
  if (options.config.context.requireApproval && !approved) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: 'Context approval was required but not provided.', preview});
    await emitAuditEvent(options, context, {type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: 'Context approval was required but not provided.'});
    return responses;
  }

  await emitAuditEvent(options, context, {type: 'step:start', step: 'llm', message: `Invoking LLM runtime ${runtime}.`, timestamp: new Date().toISOString()});
  const task: LlmTask = {
    id: 'report-synthesis',
    promptId: 'report-synthesis',
    systemPrompt: registry.get('report-synthesis'),
    userPrompt: [
      'Synthesize a defender-focused SecFlow audit report.',
      'Separate scanner-backed findings from business logic hypotheses.',
      'Call out assumptions, confidence, exploit paths, and validation steps.',
      'Return only structured JSON matching the provided schema.'
    ].join('\n'),
    targetPath,
    context: contextPackage as unknown as Record<string, unknown>,
    outputSchema: reportSynthesisOutputJsonSchema as unknown as Record<string, unknown>
  };
  const response = await invokeConfiguredRuntime(options.config, task, runtime, context ? (event) => recordLlmRuntimeEvent(context, event) : undefined);
  if (response) {
    const synthesis = validateReportSynthesisOutput(response.structured ?? parseMaybeJson(response.text));
    responses.push({
      ...response,
      structured: synthesis,
      text: renderReportSynthesisMarkdown(synthesis)
    });
  }
  await emitAuditEvent(options, context, {type: 'step:complete', step: 'llm', message: response ? `Runtime ${runtime} completed.` : `Runtime ${runtime} was not invoked.`, timestamp: new Date().toISOString()});
  return responses;
}

export function createAuditRunner(options: AuditOptions): {run: () => Promise<AuditRun>} {
  return {
    run: () => runAudit(options)
  };
}

async function maybeExtractBusinessWorkflowWithLlm(options: AuditOptions, targetPath: string, profile: AuditRun['profile'], heuristic: AuditRun['business'], runDir: string, context: AuditContext): Promise<AuditRun['business'] | undefined> {
  const runtime = options.runtime ?? options.config.defaultRuntime;
  if (!runtime) {
    return undefined;
  }

  const registry = await PromptRegistry.fromDirectory(targetPath, options.config.prompts.directory);
  registry.validateRequired(options.config.prompts.required);
  const contextPackage = redactContext(await buildWorkflowExtractionContext(targetPath, profile, heuristic), options.config.context.redactions);
  const size = contextSizeBytes(contextPackage);
  const contextPath = path.join(runDir, 'workflow-extraction-context-preview.json');
  await writeJson(contextPath, {sizeBytes: size, context: contextPackage});
  const preview: ContextPreview = {
    runtime,
    promptId: 'workflow-extraction',
    sizeBytes: size,
    maxBytes: options.config.context.maxBytes,
    requireApproval: options.config.context.requireApproval,
    redactionPatternCount: options.config.context.redactions.length,
    contextPath
  };
  options.onEvent?.({type: 'context:preview', step: 'context-preview', timestamp: new Date().toISOString(), preview});
  context.caseFile = await context.store.appendEvent(context.caseFile.caseId, {type: 'context:preview', step: 'context-preview', timestamp: new Date().toISOString(), preview});

  if (size > options.config.context.maxBytes) {
    await writeJson(path.join(runDir, 'workflow-extraction-llm-skip.json'), {reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`, sizeBytes: size});
    await emitCaseEvent(context, {type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: `Workflow extraction context package exceeded ${options.config.context.maxBytes} bytes.`});
    return undefined;
  }

  const approved = await resolveContextApproval(options, preview);
  context.caseFile = await context.store.save({
    ...context.caseFile,
    approvals: [
      ...context.caseFile.approvals,
      {
        id: `approval:workflow-extraction:${Date.now()}`,
        kind: 'llm-context',
        requestedAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        approved,
        artifactPath: contextPath,
        reason: approved ? 'Approved workflow extraction runtime invocation.' : 'Workflow extraction context approval was denied.',
        metadata: {promptId: 'workflow-extraction'}
      }
    ]
  });
  if (options.config.context.requireApproval && !approved) {
    await writeJson(path.join(runDir, 'workflow-extraction-llm-skip.json'), {reason: 'Context approval was required but not provided.', preview});
    await emitCaseEvent(context, {type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: 'Workflow extraction context approval was required but not provided.'});
    return undefined;
  }

  await emitCaseEvent(context, {type: 'step:start', step: 'llm', message: `Invoking workflow extraction runtime ${runtime}.`, timestamp: new Date().toISOString()});
  const response = await invokeConfiguredRuntime(
    options.config,
    {
      id: 'workflow-extraction',
      promptId: 'workflow-extraction',
      systemPrompt: registry.get('workflow-extraction'),
      userPrompt: [
        'Extract a defender-focused business workflow model from the repository profile and sampled source files.',
        'Separate concrete code evidence from hypotheses.',
        'Return only structured JSON matching the provided schema.'
      ].join('\n'),
      targetPath,
      context: contextPackage as Record<string, unknown>,
      outputSchema: workflowExtractionOutputJsonSchema as unknown as Record<string, unknown>
    },
    runtime,
    (event) => recordLlmRuntimeEvent(context, event)
  );
  if (!response) {
    await emitCaseEvent(context, {type: 'step:complete', step: 'llm', message: `Workflow extraction runtime ${runtime} was not invoked.`, timestamp: new Date().toISOString()});
    return undefined;
  }
  const extracted = validateWorkflowExtractionOutput(response.structured ?? parseMaybeJson(response.text));
  await context.store.writeArtifact(context.caseFile.caseId, 'workflow-extraction-llm-response.json', response, {kind: 'json', description: 'LLM workflow extraction response'});
  await emitCaseEvent(context, {type: 'step:complete', step: 'llm', message: `Workflow extraction runtime ${runtime} completed.`, timestamp: new Date().toISOString()});
  return {
    generatedAt: new Date().toISOString(),
    ...extracted
  };
}

async function buildWorkflowExtractionContext(targetPath: string, profile: AuditRun['profile'], heuristic: AuditRun['business']): Promise<Record<string, unknown>> {
  const candidateFiles = [...new Set([...profile.securityRelevantFiles, ...profile.sampledFiles.map((sample) => sample.path)])].slice(0, 40);
  const fileSamples = (
    await Promise.all(
      candidateFiles.map(async (relativePath) => {
        const content = await readSmallTextFile(targetPath, relativePath).catch(() => undefined);
        if (!content) {
          return undefined;
        }
        return {
          path: relativePath,
          content: content.slice(0, 6000)
        };
      })
    )
  ).filter((sample): sample is {path: string; content: string} => Boolean(sample));
  return {
    repository: {
      targetPath: profile.targetPath,
      manifests: profile.manifests,
      likelyFrameworks: profile.likelyFrameworks,
      notableDirectories: profile.notableDirectories,
      securityRelevantFiles: profile.securityRelevantFiles.slice(0, 80)
    },
    heuristic,
    fileSamples
  };
}

function buildAuditWorkflow(): Array<WorkflowStep<AuditContext>> {
  return [
    {
      id: 'profile',
      title: 'Repository profile',
      async run(context) {
        await emitCaseEvent(context, {type: 'step:start', step: 'profile', message: 'Profiling repository.', timestamp: new Date().toISOString()});
        context.profile = await profileRepository(context.targetPath);
        await context.store.writeArtifact(context.caseFile.caseId, 'repo-profile.json', context.profile, {kind: 'json', description: 'Repository profile'});
        context.caseFile = await context.store.save({...context.caseFile, profile: context.profile});
        await emitCaseEvent(context, {
          type: 'step:complete',
          step: 'profile',
          message: `Profiled ${context.profile.fileCount} files.`,
          timestamp: new Date().toISOString(),
          data: {fileCount: context.profile.fileCount}
        });
      }
    },
    {
      id: 'repo-map',
      title: 'Repository map',
      dependencies: ['profile'],
      async run(context) {
        if (!context.profile) throw new Error('Repository profile is required before repo map.');
        await emitCaseEvent(context, {type: 'step:start', step: 'repo-map', message: 'Building repository map.', timestamp: new Date().toISOString()});
        context.repoMap = buildRepoMap(context.profile);
        await context.store.writeArtifact(context.caseFile.caseId, 'repo-map.json', context.repoMap, {kind: 'json', description: 'Repository map'});
        context.caseFile = await context.store.save({...context.caseFile, repoMap: context.repoMap});
        await emitCaseEvent(context, {type: 'step:complete', step: 'repo-map', message: 'Repository map written.', timestamp: new Date().toISOString()});
      }
    },
    {
      id: 'business-workflows',
      title: 'Business workflow extraction',
      dependencies: ['repo-map'],
      async run(context) {
        if (!context.profile) throw new Error('Repository profile is required before business workflow extraction.');
        await emitCaseEvent(context, {type: 'step:start', step: 'business-workflows', message: 'Extracting business workflow signals.', timestamp: new Date().toISOString()});
        const heuristic = await extractBusinessWorkflowModel(context.targetPath, context.profile);
        context.business = (await maybeExtractBusinessWorkflowWithLlm(context.options, context.targetPath, context.profile, heuristic, context.runDir, context)) ?? heuristic;
        await context.store.writeArtifact(context.caseFile.caseId, 'business-workflow.json', context.business, {kind: 'json', description: 'Business workflow model'});
        context.caseFile = await context.store.save({...context.caseFile, business: context.business});
        await emitCaseEvent(context, {
          type: 'step:complete',
          step: 'business-workflows',
          message: `Extracted ${context.business.risks.length} business logic hypotheses.`,
          timestamp: new Date().toISOString(),
          data: {riskCount: context.business.risks.length}
        });
      }
    },
    {
      id: 'tools',
      title: 'Deterministic tools',
      dependencies: ['business-workflows'],
      async run(context) {
        await emitCaseEvent(context, {type: 'step:start', step: 'tools', message: 'Running registered deterministic security tools.', timestamp: new Date().toISOString()});
        const toolEvents: AuditEvent[] = [];
        context.toolResults = await runConfiguredTools(context.targetPath, context.runDir, context.options.config, (result) => {
          const event: AuditEvent = {type: 'tool:complete', step: 'tools', timestamp: new Date().toISOString(), result};
          toolEvents.push(event);
          context.options.onEvent?.(event);
        });
        for (const event of toolEvents) {
          context.caseFile = await context.store.appendEvent(context.caseFile.caseId, event);
        }
        await context.store.writeArtifact(context.caseFile.caseId, 'tool-results.json', context.toolResults, {kind: 'json', description: 'Scanner run results'});
        context.caseFile = await context.store.save({...context.caseFile, toolResults: context.toolResults});
        await emitCaseEvent(context, {type: 'step:complete', step: 'tools', message: `Completed ${context.toolResults.length} tool checks.`, timestamp: new Date().toISOString(), data: {toolCount: context.toolResults.length}});
      }
    },
    {
      id: 'finding-normalization',
      title: 'Finding normalization',
      dependencies: ['tools'],
      async run(context) {
        if (!context.business) throw new Error('Business workflow model is required before finding normalization.');
        await emitCaseEvent(context, {type: 'step:start', step: 'finding-normalization', message: 'Normalizing scanner and business findings.', timestamp: new Date().toISOString()});
        context.findings = collectFindings(context.toolResults, context.business);
        await context.store.writeArtifact(context.caseFile.caseId, 'normalized-findings.json', context.findings, {kind: 'json', description: 'Normalized findings'});
        context.caseFile = await context.store.save({...context.caseFile, findings: context.findings, evidence: buildEvidence(context.findings)});
        await emitCaseEvent(context, {type: 'step:complete', step: 'finding-normalization', message: `Normalized ${context.findings.length} findings.`, timestamp: new Date().toISOString(), data: {findingCount: context.findings.length}});
      }
    },
    {
      id: 'llm-synthesis',
      title: 'LLM synthesis',
      dependencies: ['finding-normalization'],
      async run(context) {
        if (!context.profile || !context.business) throw new Error('Profile and business model are required before LLM synthesis.');
        context.llmResponses = await maybeInvokeLlm(context.options, context.targetPath, context.profile, context.business, context.findings, context.runDir, context);
        await context.store.writeArtifact(context.caseFile.caseId, 'llm-responses.json', context.llmResponses, {kind: 'json', description: 'LLM responses'});
        await context.store.writeArtifact(context.caseFile.caseId, 'llm-events.json', context.llmEvents, {kind: 'json', description: 'LLM runtime events'});
        context.caseFile = await context.store.save({...context.caseFile, llmResponses: context.llmResponses, llmEvents: context.llmEvents});
      }
    },
    {
      id: 'remediation-drafting',
      title: 'Remediation patch drafts',
      dependencies: ['finding-normalization'],
      approvalKind: 'patch-draft',
      async run(context) {
        await emitCaseEvent(context, {type: 'step:start', step: 'remediation-drafting', message: 'Drafting reviewable remediation patches.', timestamp: new Date().toISOString()});
        context.remediationDrafts = renderPatchDrafts(context.findings);
        for (const draft of context.remediationDrafts) {
          const artifact = await context.store.writeArtifact(context.caseFile.caseId, `patch-drafts/${draft.id.replace(/[^a-zA-Z0-9_.-]/g, '-')}.md`, draft.patch, {
            kind: 'patch-draft',
            description: draft.title
          });
          draft.artifactPath = artifact.path;
        }
        await context.store.writeArtifact(context.caseFile.caseId, 'remediation-drafts.json', context.remediationDrafts, {kind: 'json', description: 'Remediation draft index'});
        context.caseFile = await context.store.save({...context.caseFile, remediationDrafts: context.remediationDrafts});
        await emitCaseEvent(context, {type: 'step:complete', step: 'remediation-drafting', message: `Drafted ${context.remediationDrafts.length} patch artifacts.`, timestamp: new Date().toISOString(), data: {draftCount: context.remediationDrafts.length}});
      }
    },
    {
      id: 'reports',
      title: 'Report export',
      dependencies: ['finding-normalization'],
      async run(context) {
        if (!context.profile || !context.business) throw new Error('Profile and business model are required before reports.');
        await emitCaseEvent(context, {type: 'step:start', step: 'reports', message: 'Writing Markdown, JSON, and SARIF reports.', timestamp: new Date().toISOString()});
        const reportWithoutPaths = {
          runId: context.runId,
          caseId: context.caseFile.caseId,
          targetPath: context.targetPath,
          runDir: context.runDir,
          profile: context.profile,
          repoMap: context.repoMap,
          business: context.business,
          toolResults: context.toolResults,
          findings: context.findings,
          llmResponses: context.llmResponses,
          llmEvents: context.llmEvents,
          remediationDrafts: context.remediationDrafts
        };
        const reportPath = path.join(context.runDir, 'report.md');
        const jsonReportPath = path.join(context.runDir, 'report.json');
        const sarifPath = path.join(context.runDir, 'report.sarif');
        context.reportPath = reportPath;
        context.jsonReportPath = jsonReportPath;
        context.sarifPath = sarifPath;
        await writeText(reportPath, renderMarkdownReport(reportWithoutPaths));
        await writeJson(jsonReportPath, renderJsonReport(reportWithoutPaths));
        await writeJson(sarifPath, renderSarif(context.findings));
        await writeJson(path.join(context.runDir, 'manifest.json'), {
          runId: context.runId,
          caseId: context.caseFile.caseId,
          targetPath: context.targetPath,
          generatedAt: new Date().toISOString(),
          reportPath,
          jsonReportPath,
          sarifPath,
          findingCount: context.findings.length,
          llmInvoked: context.llmResponses.length > 0,
          remediationDraftCount: context.remediationDrafts.length
        });
        context.caseFile = await context.store.save({
          ...context.caseFile,
          reportPath,
          jsonReportPath,
          sarifPath
        });
        await emitCaseEvent(context, {type: 'step:complete', step: 'reports', message: 'Reports written.', timestamp: new Date().toISOString(), data: {reportPath, sarifPath}});
      }
    }
  ];
}

async function resolveContextApproval(options: AuditOptions, preview: ContextPreview): Promise<boolean> {
  if (!options.config.context.requireApproval) {
    return true;
  }
  if (options.approveContext) {
    return Boolean(await options.approveContext(preview));
  }
  return Boolean(options.contextApproved);
}

async function resolveWorkflowApproval(context: AuditContext, kind: ApprovalKind): Promise<boolean> {
  if (kind !== 'patch-draft') {
    return true;
  }
  const approved = context.options.approveRemediationDraft
    ? Boolean(await context.options.approveRemediationDraft(context.findings))
    : Boolean(context.options.remediationDraftApproved);
  context.caseFile = await context.store.save({
    ...context.caseFile,
    approvals: [
      ...context.caseFile.approvals,
      {
        id: `approval:${kind}:${Date.now()}`,
        kind,
        requestedAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        approved,
        reason: approved ? 'Approved patch draft artifact generation.' : 'Patch draft artifact generation was denied.'
      }
    ]
  });
  if (!approved) {
    await emitCaseEvent(context, {type: 'step:complete', step: 'remediation-drafting', message: 'Patch draft approval was not provided.', timestamp: new Date().toISOString()});
  }
  return approved;
}

async function emitAuditEvent(options: AuditOptions, context: AuditContext | undefined, event: AuditEvent): Promise<void> {
  options.onEvent?.(event);
  if (context) {
    context.caseFile = await context.store.appendEvent(context.caseFile.caseId, event);
  }
}

async function emitCaseEvent(context: AuditContext, event: AuditEvent): Promise<void> {
  await emitAuditEvent(context.options, context, event);
}

function recordLlmRuntimeEvent(context: AuditContext, event: LlmRuntimeEvent): void {
  context.llmEvents.push(event);
  context.options.onEvent?.({type: 'llm:runtime-event', step: 'llm', timestamp: event.timestamp, event});
}

function buildRepoMap(profile: AuditRun['profile']): RepoMap {
  return {
    generatedAt: new Date().toISOString(),
    root: profile.targetPath,
    manifests: profile.manifests,
    frameworks: profile.likelyFrameworks,
    notableDirectories: profile.notableDirectories,
    extensionSummary: profile.extensions,
    sampledFiles: profile.sampledFiles
  };
}

function buildEvidence(findings: NormalizedFinding[]): CaseFile['evidence'] {
  return findings.flatMap((finding) =>
    finding.evidence.map((evidence, index) => ({
      id: `evidence:${finding.id}:${index}`,
      kind: finding.source === 'business-logic' ? 'business-signal' : 'scanner',
      source: finding.source,
      summary: evidence,
      artifactPath: finding.path,
      findingIds: [finding.id]
    }))
  );
}
