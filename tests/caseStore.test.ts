// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import {createCaseStore, createWorkflowRecords} from '../src/core/caseStore.js';

describe('case store', () => {
  it('creates, loads, updates, and appends events to canonical case files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-case-'));
    const store = createCaseStore(root);
    const created = await store.create({
      caseId: 'demo',
      targetPath: root,
      workflow: createWorkflowRecords([{id: 'profile', title: 'Profile repository'}])
    });

    await store.appendEvent(created.caseId, {type: 'step:start', step: 'profile', message: 'Profiling.', timestamp: new Date().toISOString()});
    const loaded = await store.load('demo');

    expect(loaded.caseId).toBe('demo');
    expect(loaded.workflow[0]).toMatchObject({id: 'profile', state: 'pending'});
    expect(loaded.events[0]).toMatchObject({type: 'step:start', step: 'profile'});
  });

  it('writes artifacts under the case artifacts directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-case-'));
    const store = createCaseStore(root);
    const created = await store.create({caseId: 'artifacts', targetPath: root});

    const artifact = await store.writeArtifact(created.caseId, 'reports/report.json', {ok: true}, {kind: 'json', description: 'Report'});
    const loaded = await store.load(created.caseId);

    expect(artifact.path).toContain(path.join('.secflow', 'cases', 'artifacts', 'artifacts', 'reports', 'report.json'));
    expect(await readFile(artifact.path, 'utf8')).toContain('"ok": true');
    expect(loaded.artifacts[0]).toMatchObject({kind: 'json', description: 'Report'});
  });

  it('rejects artifact paths outside the case directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-case-'));
    const store = createCaseStore(root);
    const created = await store.create({caseId: 'safe-paths', targetPath: root});

    await expect(store.writeArtifact(created.caseId, '../escape.json', {}, {kind: 'json'})).rejects.toThrow(/within the case artifacts/);
  });
});
