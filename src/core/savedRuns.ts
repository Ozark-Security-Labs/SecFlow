// SPDX-License-Identifier: AGPL-3.0-only
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import type {AuditRun, BusinessWorkflowModel, CaseFile, LlmResponse, LlmRuntimeEvent, NormalizedFinding, RemediationDraft, RepoMap, RepoProfile, ToolRunResult} from './types.js';
import {parseCaseFile} from './schemas.js';
import {readJson} from '../util/files.js';

export interface SavedRunSummary {
  caseId: string;
  title: string;
  targetPath: string;
  updatedAt: string;
  status: CaseFile['status'];
  findingCount: number;
  scannerFindingCount: number;
  businessFindingCount: number;
  llmInvoked: boolean;
  remediationDraftCount: number;
}

export async function listSavedRuns(rootDir: string): Promise<SavedRunSummary[]> {
  const casesDir = path.join(rootDir, '.secflow', 'cases');
  let entries: string[];
  try {
    entries = await readdir(casesDir);
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(entries.map((entry) => readCaseSummaryIfPresent(casesDir, entry)));
  return summaries.filter((summary): summary is SavedRunSummary => Boolean(summary)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadSavedRun(rootDir: string, caseId: string): Promise<AuditRun> {
  return caseToAuditRun(await readCase(path.join(rootDir, '.secflow', 'cases'), caseId));
}

async function summarizeCase(caseFile: CaseFile): Promise<SavedRunSummary> {
  const report = await readReportJson(caseFile);
  if (!(caseFile.profile ?? report?.repository) || !(caseFile.business ?? report?.business) || !caseFile.reportPath || !caseFile.sarifPath) {
    throw new Error(`Case ${caseFile.caseId} is missing completed run artifacts.`);
  }
  const toolResults = mergeToolResults(caseFile.toolResults, report?.toolResults);
  const findings = mergeFindings(caseFile.findings, [...reportFindings(report), ...toolResultFindings(toolResults)]);
  const scannerFindings = findings.filter((finding) => finding.source !== 'business-logic');
  const businessFindings = findings.filter((finding) => finding.source === 'business-logic');
  const llmResponses = mergeByRuntimeAndText(caseFile.llmResponses, report?.llmResponses);
  const llmEvents = mergeLlmEvents(caseFile.llmEvents, report?.llmEvents);
  const remediationDrafts = mergeById(caseFile.remediationDrafts, report?.remediationDrafts);
  return {
    caseId: caseFile.caseId,
    title: caseFile.title,
    targetPath: caseFile.targetPath,
    updatedAt: caseFile.updatedAt,
    status: caseFile.status,
    findingCount: findings.length,
    scannerFindingCount: scannerFindings.length,
    businessFindingCount: businessFindings.length,
    llmInvoked: llmResponses.length > 0 || llmEvents.length > 0,
    remediationDraftCount: remediationDrafts.length
  };
}

async function caseToAuditRun(caseFile: CaseFile): Promise<AuditRun> {
  const report = await readReportJson(caseFile);
  const profile = caseFile.profile ?? report?.repository;
  const business = caseFile.business ?? report?.business;
  const toolResults = mergeToolResults(caseFile.toolResults, report?.toolResults);
  const findings = mergeFindings(caseFile.findings, [...reportFindings(report), ...toolResultFindings(toolResults)]);
  const llmResponses = mergeByRuntimeAndText(caseFile.llmResponses, report?.llmResponses);
  const llmEvents = mergeLlmEvents(caseFile.llmEvents, report?.llmEvents);
  const remediationDrafts = mergeById(caseFile.remediationDrafts, report?.remediationDrafts);

  if (!profile || !business || !caseFile.reportPath || !caseFile.sarifPath) {
    throw new Error(`Case ${caseFile.caseId} is missing completed run artifacts.`);
  }
  return {
    runId: caseFile.caseId,
    caseId: caseFile.caseId,
    targetPath: caseFile.targetPath,
    runDir: path.dirname(caseFile.reportPath),
    profile,
    repoMap: caseFile.repoMap ?? report?.repoMap,
    business,
    toolResults,
    findings,
    llmResponses,
    llmEvents,
    remediationDrafts,
    reportPath: caseFile.reportPath,
    jsonReportPath: caseFile.jsonReportPath,
    sarifPath: caseFile.sarifPath
  };
}

async function readCaseSummaryIfPresent(casesDir: string, entry: string): Promise<SavedRunSummary | undefined> {
  try {
    return await summarizeCase(await readCase(casesDir, entry));
  } catch {
    return undefined;
  }
}

async function readCase(casesDir: string, caseId: string): Promise<CaseFile> {
  return parseCaseFile(await readJson(path.join(casesDir, sanitizeCaseId(caseId), 'case.json'))) as CaseFile;
}

function sanitizeCaseId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function isMissingDirectoryError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

interface SavedRunReport {
  repository?: RepoProfile;
  repoMap?: RepoMap;
  business?: BusinessWorkflowModel;
  scannerFindings?: NormalizedFinding[];
  businessLogicHypotheses?: NormalizedFinding[];
  toolResults?: ToolRunResult[];
  llmResponses?: LlmResponse[];
  llmEvents?: LlmRuntimeEvent[];
  remediationDrafts?: RemediationDraft[];
}

async function readReportJson(caseFile: CaseFile): Promise<SavedRunReport | undefined> {
  if (!caseFile.jsonReportPath) {
    return undefined;
  }
  try {
    const report = await readJson<unknown>(caseFile.jsonReportPath);
    if (!isRecord(report)) {
      return undefined;
    }
    return {
      repository: isRepoProfile(report.repository) ? report.repository : undefined,
      repoMap: toRepoMap(report.repoMap, caseFile),
      business: isBusinessWorkflowModel(report.business) ? report.business : undefined,
      scannerFindings: isNormalizedFindingArray(report.scannerFindings) ? report.scannerFindings : undefined,
      businessLogicHypotheses: isNormalizedFindingArray(report.businessLogicHypotheses) ? report.businessLogicHypotheses : undefined,
      toolResults: isToolRunResultArray(report.toolResults) ? report.toolResults : undefined,
      llmResponses: isLlmResponseArray(report.llmResponses) ? report.llmResponses : undefined,
      llmEvents: isLlmRuntimeEventArray(report.llmEvents) ? report.llmEvents : undefined,
      remediationDrafts: isRemediationDraftArray(report.remediationDrafts) ? report.remediationDrafts : undefined
    };
  } catch {
    return undefined;
  }
}

function reportFindings(report: SavedRunReport | undefined): NormalizedFinding[] {
  return [...(report?.scannerFindings ?? []), ...(report?.businessLogicHypotheses ?? [])];
}

function toolResultFindings(toolResults: ToolRunResult[]): NormalizedFinding[] {
  return toolResults.flatMap((result) => result.findings);
}

function mergeFindings(caseFindings: NormalizedFinding[], reportFindings: NormalizedFinding[]): NormalizedFinding[] {
  return mergeById(reportFindings, caseFindings);
}

function mergeToolResults(caseResults: ToolRunResult[], reportResults: ToolRunResult[] | undefined): ToolRunResult[] {
  const byTool = new Map<string, ToolRunResult>();
  for (const result of reportResults ?? []) byTool.set(result.tool, result);
  for (const result of caseResults) byTool.set(result.tool, result);
  return [...byTool.values()];
}

function mergeById<T extends {id: string}>(reportItems: T[] | undefined, caseItems: T[] | undefined): T[] {
  const byId = new Map<string, T>();
  for (const item of reportItems ?? []) byId.set(item.id, item);
  for (const item of caseItems ?? []) byId.set(item.id, item);
  return [...byId.values()];
}

function mergeByRuntimeAndText(caseResponses: LlmResponse[], reportResponses: LlmResponse[] | undefined): LlmResponse[] {
  const byKey = new Map<string, LlmResponse>();
  for (const response of reportResponses ?? []) byKey.set(`${response.runtime}:${response.text}`, response);
  for (const response of caseResponses) byKey.set(`${response.runtime}:${response.text}`, response);
  return [...byKey.values()];
}

function mergeLlmEvents(caseEvents: LlmRuntimeEvent[] | undefined, reportEvents: LlmRuntimeEvent[] | undefined): LlmRuntimeEvent[] {
  const byKey = new Map<string, LlmRuntimeEvent>();
  for (const event of reportEvents ?? []) byKey.set(`${event.timestamp}:${event.runtime}:${event.taskId}:${event.type}:${event.message}`, event);
  for (const event of caseEvents ?? []) byKey.set(`${event.timestamp}:${event.runtime}:${event.taskId}:${event.type}:${event.message}`, event);
  return [...byKey.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRepoProfile(value: unknown): value is RepoProfile {
  return isRecord(value) && typeof value.targetPath === 'string' && typeof value.generatedAt === 'string' && typeof value.fileCount === 'number' && Array.isArray(value.sampledFiles);
}

function toRepoMap(value: unknown, caseFile: CaseFile): RepoMap | undefined {
  if (!isRecord(value) || !Array.isArray(value.manifests) || !Array.isArray(value.frameworks) || !isRecord(value.extensionSummary)) {
    return undefined;
  }
  return {
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : caseFile.updatedAt,
    root: typeof value.root === 'string' ? value.root : caseFile.targetPath,
    manifests: value.manifests.filter((item): item is string => typeof item === 'string'),
    frameworks: value.frameworks.filter((item): item is string => typeof item === 'string'),
    notableDirectories: Array.isArray(value.notableDirectories) ? value.notableDirectories.filter((item): item is string => typeof item === 'string') : [],
    extensionSummary: Object.fromEntries(Object.entries(value.extensionSummary).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    sampledFiles: Array.isArray(value.sampledFiles) ? (value.sampledFiles as RepoMap['sampledFiles']) : []
  };
}

function isBusinessWorkflowModel(value: unknown): value is BusinessWorkflowModel {
  return isRecord(value) && typeof value.generatedAt === 'string' && Array.isArray(value.actors) && Array.isArray(value.reviewQuestions) && Array.isArray(value.risks);
}

function isNormalizedFindingArray(value: unknown): value is NormalizedFinding[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.source === 'string' && typeof item.title === 'string');
}

function isToolRunResultArray(value: unknown): value is ToolRunResult[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.tool === 'string' && Array.isArray(item.findings));
}

function isLlmResponseArray(value: unknown): value is LlmResponse[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.runtime === 'string' && typeof item.text === 'string');
}

function isLlmRuntimeEventArray(value: unknown): value is LlmRuntimeEvent[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.runtime === 'string' && typeof item.taskId === 'string' && typeof item.message === 'string');
}

function isRemediationDraftArray(value: unknown): value is RemediationDraft[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.findingId === 'string');
}
