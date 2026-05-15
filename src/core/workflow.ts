// SPDX-License-Identifier: AGPL-3.0-only
import type {ApprovalKind, WorkflowStepRecord, WorkflowStepState} from './types.js';

export interface WorkflowStep<TContext> {
  id: string;
  title: string;
  dependencies?: string[];
  approvalKind?: ApprovalKind;
  run(context: TContext, controls: WorkflowControls): Promise<void>;
}

export interface WorkflowControls {
  requestApproval(kind: ApprovalKind, stepId: string): Promise<boolean>;
  onStepChange?(step: WorkflowStepRecord): void | Promise<void>;
}

export interface WorkflowRunResult<TContext> {
  context: TContext;
  steps: WorkflowStepRecord[];
}

export class WorkflowFailedError extends Error {
  constructor(
    message: string,
    readonly stepId: string
  ) {
    super(message);
  }
}

export async function runWorkflow<TContext>(
  steps: Array<WorkflowStep<TContext>>,
  context: TContext,
  controls: WorkflowControls
): Promise<WorkflowRunResult<TContext>> {
  const records = createStepRecords(steps);
  validateWorkflow(records);

  for (const step of steps) {
    const record = getRecord(records, step.id);
    if (!dependenciesComplete(records, record)) {
      await updateRecord(records, step.id, controls, {state: 'skipped', completedAt: now(), error: 'Dependencies did not complete.'});
      continue;
    }

    if (step.approvalKind) {
      await updateRecord(records, step.id, controls, {state: 'waiting-for-approval', approvalKind: step.approvalKind});
      const approved = await controls.requestApproval(step.approvalKind, step.id);
      if (!approved) {
        await updateRecord(records, step.id, controls, {state: 'skipped', completedAt: now(), error: `Approval denied for ${step.approvalKind}.`});
        continue;
      }
    }

    await updateRecord(records, step.id, controls, {state: 'running', startedAt: now()});
    try {
      await step.run(context, controls);
      await updateRecord(records, step.id, controls, {state: 'complete', completedAt: now(), error: undefined});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateRecord(records, step.id, controls, {state: 'failed', completedAt: now(), error: message});
      throw new WorkflowFailedError(message, step.id);
    }
  }

  return {context, steps: records};
}

export function createStepRecords<TContext>(steps: Array<WorkflowStep<TContext>>): WorkflowStepRecord[] {
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    dependencies: step.dependencies ?? [],
    approvalKind: step.approvalKind,
    state: 'pending',
    artifactIds: []
  }));
}

function validateWorkflow(records: WorkflowStepRecord[]): void {
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    for (const dependency of record.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`Workflow step ${record.id} depends on missing step ${dependency}.`);
      }
    }
  }
}

function dependenciesComplete(records: WorkflowStepRecord[], record: WorkflowStepRecord): boolean {
  return record.dependencies.every((dependency) => getRecord(records, dependency).state === 'complete');
}

function getRecord(records: WorkflowStepRecord[], stepId: string): WorkflowStepRecord {
  const record = records.find((candidate) => candidate.id === stepId);
  if (!record) {
    throw new Error(`Unknown workflow step: ${stepId}`);
  }
  return record;
}

async function updateRecord(
  records: WorkflowStepRecord[],
  stepId: string,
  controls: WorkflowControls,
  updates: Partial<Omit<WorkflowStepRecord, 'id' | 'title' | 'dependencies' | 'artifactIds'>> & {state: WorkflowStepState}
): Promise<void> {
  const index = records.findIndex((record) => record.id === stepId);
  const next = {...records[index]!, ...updates};
  records[index] = next;
  await controls.onStepChange?.(next);
}

function now(): string {
  return new Date().toISOString();
}
