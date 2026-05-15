// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import {runWorkflow, WorkflowFailedError, type WorkflowStep} from '../src/core/workflow.js';

interface Context {
  events: string[];
}

describe('workflow runner', () => {
  it('runs dependent steps in order', async () => {
    const steps: Array<WorkflowStep<Context>> = [
      {id: 'profile', title: 'Profile', run: async (context) => context.events.push('profile')},
      {id: 'reports', title: 'Reports', dependencies: ['profile'], run: async (context) => context.events.push('reports')}
    ];

    const result = await runWorkflow(steps, {events: []}, {requestApproval: async () => true});

    expect(result.context.events).toEqual(['profile', 'reports']);
    expect(result.steps.map((step) => step.state)).toEqual(['complete', 'complete']);
  });

  it('skips approval-gated steps when denied', async () => {
    const result = await runWorkflow(
      [{id: 'patch', title: 'Patch draft', approvalKind: 'patch-draft', run: async (context: Context) => context.events.push('patch')}],
      {events: []},
      {requestApproval: async () => false}
    );

    expect(result.context.events).toEqual([]);
    expect(result.steps[0]).toMatchObject({state: 'skipped', error: 'Approval denied for patch-draft.'});
  });

  it('marks failed steps and stops execution', async () => {
    const steps: Array<WorkflowStep<Context>> = [
      {
        id: 'tools',
        title: 'Tools',
        run: async () => {
          throw new Error('scanner failed');
        }
      },
      {id: 'reports', title: 'Reports', dependencies: ['tools'], run: async (context) => context.events.push('reports')}
    ];

    await expect(runWorkflow(steps, {events: []}, {requestApproval: async () => true})).rejects.toBeInstanceOf(WorkflowFailedError);
  });
});
