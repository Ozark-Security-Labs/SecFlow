import path from 'node:path';
import type {AuditEvent, AuditRun, AuditStep, ContextPreview, LlmResponse, LlmTask, NormalizedFinding, SecFlowConfig} from './types.js';
import {extractBusinessWorkflowModel} from './business.js';
import {buildContextPackage, contextSizeBytes, redactContext} from './context.js';
import {collectFindings} from './findings.js';
import {profileRepository} from './profile.js';
import {PromptRegistry} from './prompts.js';
import {renderMarkdownReport, renderSarif} from './reports.js';
import {runConfiguredTools} from '../tools/registry.js';
import {ensureDir, writeJson, writeText} from '../util/files.js';
import {invokeConfiguredRuntime} from '../llm/runtimeRegistry.js';

export interface AuditOptions {
  targetPath: string;
  config: SecFlowConfig;
  contextApproved?: boolean;
  approveContext?: (preview: ContextPreview) => boolean | Promise<boolean>;
  onEvent?: (event: AuditEvent) => void;
  runtime?: string;
}

export async function runAudit(options: AuditOptions): Promise<AuditRun> {
  try {
    const targetPath = path.resolve(options.targetPath);
    emit(options, 'step:start', 'initialize', `Preparing audit for ${targetPath}.`);
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(targetPath, options.config.outputs.directory, 'runs', runId);
    await ensureDir(runDir);
    emit(options, 'step:complete', 'initialize', `Run directory created.`, {runId, runDir});

    emit(options, 'step:start', 'profile', 'Profiling repository.');
    const profile = await profileRepository(targetPath);
    await writeJson(path.join(runDir, 'repo-profile.json'), profile);
    emit(options, 'step:complete', 'profile', `Profiled ${profile.fileCount} files.`, {fileCount: profile.fileCount});

    emit(options, 'step:start', 'business-workflows', 'Extracting business workflow signals.');
    const business = await extractBusinessWorkflowModel(targetPath, profile);
    await writeJson(path.join(runDir, 'business-workflow.json'), business);
    emit(options, 'step:complete', 'business-workflows', `Extracted ${business.risks.length} business logic hypotheses.`, {riskCount: business.risks.length});

    emit(options, 'step:start', 'tools', 'Running registered deterministic security tools.');
    const toolResults = await runConfiguredTools(targetPath, runDir, options.config, (result) => {
      options.onEvent?.({type: 'tool:complete', step: 'tools', timestamp: new Date().toISOString(), result});
    });
    await writeJson(path.join(runDir, 'tool-results.json'), toolResults);
    emit(options, 'step:complete', 'tools', `Completed ${toolResults.length} tool checks.`, {toolCount: toolResults.length});

    const findings = collectFindings(toolResults, business);
    await writeJson(path.join(runDir, 'normalized-findings.json'), findings);

    const llmResponses = await maybeInvokeLlm(options, targetPath, profile, business, findings, runDir);
    await writeJson(path.join(runDir, 'llm-responses.json'), llmResponses);

    emit(options, 'step:start', 'reports', 'Writing Markdown, JSON, and SARIF reports.');
    const reportWithoutPaths = {
      runId,
      targetPath,
      runDir,
      profile,
      business,
      toolResults,
      findings,
      llmResponses
    };
    const reportPath = path.join(runDir, 'report.md');
    const sarifPath = path.join(runDir, 'report.sarif');
    await writeText(reportPath, renderMarkdownReport(reportWithoutPaths));
    await writeJson(sarifPath, renderSarif(findings));
    await writeJson(path.join(runDir, 'manifest.json'), {
      runId,
      targetPath,
      generatedAt: new Date().toISOString(),
      reportPath,
      sarifPath,
      findingCount: findings.length,
      llmInvoked: llmResponses.length > 0
    });
    emit(options, 'step:complete', 'reports', 'Reports written.', {reportPath, sarifPath});

    const run = {
      ...reportWithoutPaths,
      reportPath,
      sarifPath
    };
    options.onEvent?.({type: 'run:complete', step: 'complete', timestamp: new Date().toISOString(), run});
    return run;
  } catch (error) {
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
  runDir: string
): Promise<LlmResponse[]> {
  const responses: LlmResponse[] = [];
  const runtime = options.runtime ?? options.config.defaultRuntime;
  if (!runtime) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: 'No default runtime configured.'});
    options.onEvent?.({type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: 'No default runtime configured.'});
    return responses;
  }

  emit(options, 'step:start', 'context-preview', 'Building LLM context preview.');
  const registry = await PromptRegistry.fromDirectory(targetPath, options.config.prompts.directory);
  registry.validateRequired(options.config.prompts.required);
  const context = redactContext(buildContextPackage(profile, business, findings), options.config.context.redactions);
  const size = contextSizeBytes(context);
  const contextPath = path.join(runDir, 'llm-context-preview.json');
  await writeJson(contextPath, {sizeBytes: size, context});
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
  emit(options, 'step:complete', 'context-preview', `LLM context preview is ${size} bytes.`, {sizeBytes: size, contextPath});
  if (size > options.config.context.maxBytes) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`, sizeBytes: size});
    options.onEvent?.({
      type: 'llm:skipped',
      step: 'llm',
      timestamp: new Date().toISOString(),
      reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`
    });
    return responses;
  }

  const approved = await resolveContextApproval(options, preview);
  if (options.config.context.requireApproval && !approved) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: 'Context approval was required but not provided.', preview});
    options.onEvent?.({type: 'llm:skipped', step: 'llm', timestamp: new Date().toISOString(), reason: 'Context approval was required but not provided.'});
    return responses;
  }

  emit(options, 'step:start', 'llm', `Invoking LLM runtime ${runtime}.`);
  const task: LlmTask = {
    id: 'report-synthesis',
    promptId: 'report-synthesis',
    systemPrompt: registry.get('report-synthesis'),
    userPrompt: [
      'Synthesize a defender-focused SecFlow audit report.',
      'Separate scanner-backed findings from business logic hypotheses.',
      'Call out assumptions, confidence, exploit paths, and validation steps.'
    ].join('\n'),
    targetPath,
    context: context as unknown as Record<string, unknown>
  };
  const response = await invokeConfiguredRuntime(options.config, task, runtime);
  if (response) {
    responses.push(response);
  }
  emit(options, 'step:complete', 'llm', response ? `Runtime ${runtime} completed.` : `Runtime ${runtime} was not invoked.`);
  return responses;
}

export function createAuditRunner(options: AuditOptions): {run: () => Promise<AuditRun>} {
  return {
    run: () => runAudit(options)
  };
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

function emit(options: AuditOptions, type: 'step:start' | 'step:complete', step: AuditStep, message: string, data?: Record<string, unknown>): void {
  options.onEvent?.({
    type,
    step,
    message,
    timestamp: new Date().toISOString(),
    data
  });
}
