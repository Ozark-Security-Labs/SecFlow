import path from 'node:path';
import type {AuditRun, LlmResponse, LlmTask, NormalizedFinding, SecFlowConfig} from './types.js';
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
  runtime?: string;
}

export async function runAudit(options: AuditOptions): Promise<AuditRun> {
  const targetPath = path.resolve(options.targetPath);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(targetPath, options.config.outputs.directory, 'runs', runId);
  await ensureDir(runDir);

  const profile = await profileRepository(targetPath);
  await writeJson(path.join(runDir, 'repo-profile.json'), profile);

  const business = await extractBusinessWorkflowModel(targetPath, profile);
  await writeJson(path.join(runDir, 'business-workflow.json'), business);

  const toolResults = await runConfiguredTools(targetPath, runDir, options.config);
  await writeJson(path.join(runDir, 'tool-results.json'), toolResults);

  const findings = collectFindings(toolResults, business);
  await writeJson(path.join(runDir, 'normalized-findings.json'), findings);

  const llmResponses = await maybeInvokeLlm(options, targetPath, profile, business, findings, runDir);
  await writeJson(path.join(runDir, 'llm-responses.json'), llmResponses);

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

  return {
    ...reportWithoutPaths,
    reportPath,
    sarifPath
  };
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
    return responses;
  }
  if (options.config.context.requireApproval && !options.contextApproved) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: 'Context approval was required but not provided.'});
    return responses;
  }

  const registry = await PromptRegistry.fromDirectory(targetPath, options.config.prompts.directory);
  registry.validateRequired(options.config.prompts.required);
  const context = redactContext(buildContextPackage(profile, business, findings), options.config.context.redactions);
  const size = contextSizeBytes(context);
  await writeJson(path.join(runDir, 'llm-context-preview.json'), {sizeBytes: size, context});
  if (size > options.config.context.maxBytes) {
    await writeJson(path.join(runDir, 'llm-skip.json'), {reason: `Context package exceeded ${options.config.context.maxBytes} bytes.`, sizeBytes: size});
    return responses;
  }

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
  return responses;
}
