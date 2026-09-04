#!/usr/bin/env node
/**
 * Records scripts/__tests__/fixtures/health-gate-workflows.snapshot.json — the
 * canonical parse of the four gate workflows both health-gate harnesses pin
 * structurally.
 *
 * Run this only from a working tree whose `.github/workflows/` edits are the
 * intended state of the gate: the harness reads this file as the pin, so
 * recording it is the act that blesses a workflow change, and the diff it
 * produces here is the diff a reviewer reads.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseHealthGateWorkflows, WORKFLOW_SNAPSHOT_PATH } from './healthGateWorkflowContract.ts';

const repositoryRoot = join(import.meta.dirname, '..');
const snapshotPath = join(repositoryRoot, WORKFLOW_SNAPSHOT_PATH);
const snapshot = parseHealthGateWorkflows(repositoryRoot);
mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`✓ Wrote ${WORKFLOW_SNAPSHOT_PATH} (${Object.keys(snapshot).length} workflows)`);
