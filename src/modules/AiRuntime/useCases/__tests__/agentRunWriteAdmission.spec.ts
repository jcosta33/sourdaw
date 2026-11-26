import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry } from '#/modules/Command/stores';

import { AGENT_RUN_MAX_TEXT_LENGTH, type AgentRunError } from '../../models/AgentRun';
import { MAX_COLLECTION_LENGTH } from '../../models/AgentRunPlanBounds';
import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { createReceiptSagaInput, SAGA_RUN_ID } from './agentRunReceiptSagaFixture';

const BOUND = MAX_COLLECTION_LENGTH;
const TEXT_BOUND = AGENT_RUN_MAX_TEXT_LENGTH;
const REVISION = 'revision-1';

function errorWith(index: number): AgentRunError {
    return {
        code: `error-${String(index)}`,
        message: 'An error was recorded.',
        occurredAt: 10 + index,
        retriable: false,
        workId: null,
    };
}

function fillErrors(count: number): void {
    for (let index = 0; index < count; index += 1) {
        agentRunLifecycle.recordError({ runId: SAGA_RUN_ID, error: errorWith(index) });
    }
}

function fillBatches(count: number): void {
    for (let index = 0; index < count; index += 1) {
        agentRunLifecycle.recordBatch({
            runId: SAGA_RUN_ID,
            batch: { batchId: `filler-${String(index)}`, commandIds: [], status: 'planned', receiptIdentity: null },
        });
    }
}

function fillCommittedWork(count: number): void {
    for (let index = 0; index < count; index += 1) {
        agentRunLifecycle.recordCommittedWork({
            runId: SAGA_RUN_ID,
            workId: `work-${String(index)}`,
            receiptIdentity: `receipt-${String(index)}`,
        });
    }
}

function recordContinuation(): void {
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: SAGA_RUN_ID,
        recordedAt: 50,
        continuation: {
            batchId: 'batch-receipt-saga',
            effects: [
                {
                    commandId: 'command-1',
                    operation: 'renderProjectSections',
                    reason: 'The render is pending.',
                    state: 'pending',
                    kind: 'external-effect',
                    remediation: 'manual-repair',
                },
            ],
            receiptIdentity: 'receipt-1',
            recovery: 'manual-repair',
            serializedBatch: 'batch',
            authority: {
                projectId: 'project-1',
                baseRevision: REVISION,
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                grants: {
                    allowedOperationPrefixes: [],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
                budgets: {
                    maxCommands: 1,
                    maxCreatedTracks: 0,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 0,
                    maxAffectedClips: 0,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 0,
                },
            },
            lastError: null,
        },
    });
}

type WriteCase = {
    name: string;
    prepare: () => void;
    write: () => unknown;
    refusal: string;
};

const fullMessage = (field: string) => `the run cannot hold more than ${String(BOUND)} entries in ${field}`;
const textMessage = (field: string) => `the run cannot keep ${field} longer than ${String(TEXT_BOUND)} characters`;

const cases: WriteCase[] = [
    {
        name: 'recordReceiptSaga',
        prepare: () => {
            fillCommittedWork(BOUND);
        },
        write: async () => agentRunLifecycle.recordReceiptSaga(await createReceiptSagaInput()),
        refusal: fullMessage('run.receipts'),
    },
    {
        name: 'recordCommittedRecoveryFailure',
        prepare: () => {
            fillErrors(BOUND);
        },
        write: async () =>
            agentRunLifecycle.recordCommittedRecoveryFailure({
                ...(await createReceiptSagaInput()),
                error: errorWith(BOUND),
            }),
        refusal: fullMessage('run.errors'),
    },
    {
        name: 'failPendingEffectContinuation',
        prepare: recordContinuation,
        write: () =>
            agentRunLifecycle.failPendingEffectContinuation({
                runId: SAGA_RUN_ID,
                batchId: 'batch-receipt-saga',
                reason: 'x'.repeat(TEXT_BOUND + 1),
                failedAt: 60,
            }),
        refusal: textMessage('run.pendingEffectContinuations[].lastError'),
    },
    {
        name: 'requirePendingEffectManualRepair',
        prepare: recordContinuation,
        write: () =>
            agentRunLifecycle.requirePendingEffectManualRepair({
                runId: SAGA_RUN_ID,
                batchId: 'batch-receipt-saga',
                reason: 'x'.repeat(TEXT_BOUND + 1),
                requiredAt: 60,
            }),
        refusal: textMessage('run.pendingEffectContinuations[].lastError'),
    },
    {
        name: 'completePendingEffectContinuation',
        prepare: () => {
            fillBatches(BOUND);
            recordContinuation();
        },
        write: () =>
            agentRunLifecycle.completePendingEffectContinuation({
                runId: SAGA_RUN_ID,
                batchId: 'batch-receipt-saga',
                receiptIdentity: 'receipt-1',
                completedAt: 60,
            }),
        refusal: fullMessage('run.batches'),
    },
    {
        name: 'recordPreparedStemImportRecovery',
        prepare: () => {
            agentRunLifecycle.registerTemporaryAsset({
                runId: SAGA_RUN_ID,
                assetId: 'buffer-1',
                kind: 'import',
                cleanupOwner: 'stem-import-preparation',
            });
        },
        write: () =>
            agentRunLifecycle.recordPreparedStemImportRecovery({
                runId: SAGA_RUN_ID,
                recordedAt: 60,
                recovery: {
                    schemaVersion: 1,
                    batchId: 'batch-1',
                    serializedCommandBatch: 'x'.repeat(TEXT_BOUND + 1),
                    resources: [{ audioBufferId: 'buffer-1', assetLeaseId: null }],
                },
            }),
        refusal: textMessage('run.preparedStemImports[].serializedCommandBatch'),
    },
    {
        name: 'requirePreparedStemManualRepair',
        prepare: () => {
            fillErrors(BOUND);
        },
        write: () =>
            agentRunLifecycle.requirePreparedStemManualRepair({
                runId: SAGA_RUN_ID,
                assetIds: ['buffer-1'],
                batchIds: ['batch-1'],
                requiredAt: 60,
            }),
        refusal: fullMessage('run.errors'),
    },
];

describe('every agent run write is admitted against the bounds restore reads', () => {
    afterAll(() => {
        clearHandlerRegistry();
    });

    beforeEach(() => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: SAGA_RUN_ID,
            request: 'Add the vocal compressor.',
            mode: 'apply',
            createdRevision: REVISION,
            createdAt: 100,
        });
        agentRunLifecycle.transitionPhase({
            runId: SAGA_RUN_ID,
            phase: 'planning',
            revision: REVISION,
            transitionedAt: 101,
        });
        agentRunLifecycle.transitionPhase({
            runId: SAGA_RUN_ID,
            phase: 'executing',
            revision: REVISION,
            transitionedAt: 102,
        });
    });

    it.each(cases)(
        '$name refuses a write past a bound naming the field and leaves the state untouched',
        async (row) => {
            row.prepare();
            const before = structuredClone(readAgentRunState());
            const storedBefore = window.localStorage.getItem('sourdaw-agent-runs');

            await expect(Promise.resolve().then(row.write)).rejects.toThrow(row.refusal);

            expect(readAgentRunState()).toEqual(before);
            expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(storedBefore);
        }
    );
});
