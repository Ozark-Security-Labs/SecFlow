// SPDX-License-Identifier: AGPL-3.0-only
import {stat} from 'node:fs/promises';
import path from 'node:path';
import type {ArtifactKind, ArtifactRecord, AuditEvent, CaseFile, WorkflowStepRecord} from './types.js';
import {parseCaseFile} from './schemas.js';
import {readJson, writeJson, writeText} from '../util/files.js';

export interface CaseStore {
  rootDir: string;
  casesDir: string;
  create(input: CreateCaseInput): Promise<CaseFile>;
  load(caseId: string): Promise<CaseFile>;
  save(caseFile: CaseFile): Promise<CaseFile>;
  appendEvent(caseId: string, event: AuditEvent): Promise<CaseFile>;
  writeArtifact(caseId: string, artifactPath: string, content: string | object, options: WriteArtifactOptions): Promise<ArtifactRecord>;
}

export interface CreateCaseInput {
  caseId?: string;
  title?: string;
  targetPath: string;
  workflow?: WorkflowStepRecord[];
}

export interface WriteArtifactOptions {
  kind: ArtifactKind;
  description?: string;
}

export function createCaseStore(rootDir: string): CaseStore {
  const casesDir = path.join(rootDir, '.secflow', 'cases');
  return {
    rootDir,
    casesDir,
    create: (input) => createCase(casesDir, input),
    load: (caseId) => loadCase(casesDir, caseId),
    save: (caseFile) => saveCase(casesDir, caseFile),
    appendEvent: (caseId, event) => appendCaseEvent(casesDir, caseId, event),
    writeArtifact: (caseId, artifactPath, content, options) => writeCaseArtifact(casesDir, caseId, artifactPath, content, options)
  };
}

export function createWorkflowRecords(steps: Array<{id: string; title: string; dependencies?: string[]; approvalKind?: WorkflowStepRecord['approvalKind']}>): WorkflowStepRecord[] {
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    dependencies: step.dependencies ?? [],
    approvalKind: step.approvalKind,
    state: 'pending',
    artifactIds: []
  }));
}

async function createCase(casesDir: string, input: CreateCaseInput): Promise<CaseFile> {
  const now = new Date().toISOString();
  const caseId = sanitizeCaseId(input.caseId ?? `case-${now.replace(/[:.]/g, '-')}`);
  const caseFile: CaseFile = {
    version: 1,
    caseId,
    title: input.title ?? `SecFlow audit for ${path.basename(input.targetPath) || input.targetPath}`,
    targetPath: path.resolve(input.targetPath),
    createdAt: now,
    updatedAt: now,
    status: 'open',
    workflow: input.workflow ?? [],
    events: [],
    artifacts: [],
    evidence: [],
    approvals: [],
    toolResults: [],
    findings: [],
    llmResponses: [],
    llmEvents: [],
    remediationDrafts: []
  };
  await writeJson(casePath(casesDir, caseId), caseFile);
  return caseFile;
}

async function loadCase(casesDir: string, caseId: string): Promise<CaseFile> {
  return parseCaseFile(await readJson(casePath(casesDir, sanitizeCaseId(caseId)))) as CaseFile;
}

async function saveCase(casesDir: string, caseFile: CaseFile): Promise<CaseFile> {
  const next = {...caseFile, updatedAt: new Date().toISOString()};
  const parsed = parseCaseFile(next) as CaseFile;
  await writeJson(casePath(casesDir, parsed.caseId), parsed);
  return parsed;
}

async function appendCaseEvent(casesDir: string, caseId: string, event: AuditEvent): Promise<CaseFile> {
  const caseFile = await loadCase(casesDir, caseId);
  return saveCase(casesDir, {...caseFile, events: [...caseFile.events, event]});
}

async function writeCaseArtifact(casesDir: string, caseId: string, artifactPath: string, content: string | object, options: WriteArtifactOptions): Promise<ArtifactRecord> {
  const safePath = safeRelativePath(artifactPath);
  const fullPath = path.join(caseDir(casesDir, caseId), 'artifacts', safePath);
  if (typeof content === 'string') {
    await writeText(fullPath, content);
  } else {
    await writeJson(fullPath, content);
  }

  const fileStat = await stat(fullPath);
  const record: ArtifactRecord = {
    id: artifactId(options.kind, safePath),
    kind: options.kind,
    path: fullPath,
    createdAt: new Date().toISOString(),
    bytes: fileStat.size,
    description: options.description
  };
  const caseFile = await loadCase(casesDir, caseId);
  const artifacts = [...caseFile.artifacts.filter((artifact) => artifact.id !== record.id), record];
  await saveCase(casesDir, {...caseFile, artifacts});
  return record;
}

function casePath(casesDir: string, caseId: string): string {
  return path.join(caseDir(casesDir, caseId), 'case.json');
}

function caseDir(casesDir: string, caseId: string): string {
  return path.join(casesDir, sanitizeCaseId(caseId));
}

function sanitizeCaseId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function safeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join('/');
  if (path.isAbsolute(value) || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new Error(`Artifact path must stay within the case artifacts directory: ${value}`);
  }
  return normalized;
}

function artifactId(kind: ArtifactKind, artifactPath: string): string {
  return `${kind}:${artifactPath.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
}
