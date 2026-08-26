import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    getVersionedCommandBatchCommitProof,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { compilePendingActionCommandEnvelopes } from '../compilePendingActionCommandEnvelopes';
import { recordAgentRunPendingEffectContinuation } from '../recordAgentRunPendingEffectContinuation';
import { recordAgentRunReceiptSaga } from '../recordAgentRunReceiptSaga';

type Receipt = Parameters<typeof recordAgentRunReceiptSaga>[0]['receipt'];
type PendingEffect = Receipt['pendingEffects'][number];
type CommandBatch = NonNullable<Parameters<typeof recordAgentRunReceiptSaga>[0]['commandBatch']>;
type CommandCompensation = NonNullable<Parameters<typeof createVersionedCommandReceipt>[0]['compensation']>;

const BASE_REVISION = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});

const ACTIONS = [
    {
        type: 'importStemSet',
        payload: {
            selectionId: 'selection-1',
            groupName: 'Imported Stems',
            projectTempo: 120,
            folderId: 'folder-1',
            stems: [
                {
                    stemId: 'stem-1',
                    sourceName: 'Drums.wav',
                    role: 'other',
                    sourceTempo: 120,
                    durationSeconds: 10,
                    sourceBytes: 100,
                    decodedBytes: 200,
                    audioBufferId: 'buffer-1',
                    assetHash: 'asset-hash-1',
                    assetLeaseId: 'asset-lease-1',
                    trackId: 'track-1',
                    trackName: 'Drums',
                    trackGain: 1,
                    trackPan: 0,
                    clipId: 'clip-1',
                },
            ],
        },
    },
    {
        type: 'addDevice',
        payload: {
            deviceId: 'device-compressor-1',
            trackId: 'track-vocal',
            deviceType: 'builtin-compressor',
        },
    },
] satisfies readonly [Extract<AppAction, { type: 'importStemSet' }>, Extract<AppAction, { type: 'addDevice' }>];

const arrangementHandlers = getArrangementHandlers();
registerHandlerMap({
    addDevice: arrangementHandlers.addDevice,
    importStemSet: arrangementHandlers.importStemSet,
});
const COMMANDS = compilePendingActionCommandEnvelopes({
    actions: ACTIONS,
    actionLabels: ['Import the approved stem set.', 'Add the approved compressor to the vocal track.'],
    group: {
        groupId: 'batch-agent-effects',
        groupLabel: 'Import approved stems and add the vocal compressor.',
    },
    projectRevision: BASE_REVISION,
});
const COMMAND_COMPENSATION: readonly [CommandCompensation, CommandCompensation] = [
    { available: true, strategy: 'inverse' },
    { available: true, strategy: 'inverse' },
];

const COMMAND_BATCH: CommandBatch = compileVersionedCommandBatchEnvelope({
    runId: 'run-agent-effects',
    batchId: 'batch-agent-effects',
    projectId: 'project-agent-effects',
    baseRevision: BASE_REVISION,
    intent: 'Import approved stems and add the vocal compressor.',
    commands: COMMANDS,
    mode: 'commit',
});

const parsedCommandBatch = parseVersionedCommandBatchEnvelope(COMMAND_BATCH.serialized, COMMAND_BATCH.authority);
if (parsedCommandBatch.status === 'invalid') {
    throw new Error(parsedCommandBatch.reason);
}
const COMMAND_ENVELOPE = parsedCommandBatch.envelope;
const STEM_COMMAND = COMMAND_ENVELOPE.commands[0];
const DEVICE_COMMAND = COMMAND_ENVELOPE.commands[1];
if (STEM_COMMAND?.operation !== ACTIONS[0].type || DEVICE_COMMAND?.operation !== ACTIONS[1].type) {
    throw new Error('Production command compilation did not preserve the pending-effect action order');
}

async function createReceipt(pendingEffects: readonly PendingEffect[]): Promise<Receipt> {
    const proof = await getVersionedCommandBatchCommitProof(COMMAND_BATCH);
    return createVerifiedBatchReceipt({
        contentHash: proof.contentHash,
        envelope: COMMAND_ENVELOPE,
        observedBaseRevision: BASE_REVISION,
        resultingRevision: BASE_REVISION,
        result: {
            status: 'committed-with-warning',
            warning: 'A post-commit effect remains pending.',
            warningDetails: pendingEffects.map((pendingEffect) => ({
                kind: 'external-effect',
                message: pendingEffect.reason,
                commandId: pendingEffect.commandId,
                pendingEffect,
            })),
            actions: COMMAND_ENVELOPE.commands.map((command, index) => {
                const action = ACTIONS[index];
                const compensation = COMMAND_COMPENSATION[index];
                if (!action || !compensation) {
                    throw new Error(`Missing command receipt fixture for ${command.commandId}`);
                }
                return {
                    action,
                    receipt: createVersionedCommandReceipt({
                        envelope: command,
                        compensation,
                    }),
                };
            }),
        },
    });
}

function createRun(): void {
    agentRunLifecycle.create({
        runId: 'run-agent-effects',
        request: 'Import approved stems and add the vocal compressor.',
        mode: 'apply',
        createdRevision: BASE_REVISION,
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({
        runId: 'run-agent-effects',
        phase: 'planning',
        revision: BASE_REVISION,
        transitionedAt: 101,
    });
    agentRunLifecycle.transitionPhase({
        runId: 'run-agent-effects',
        phase: 'executing',
        revision: BASE_REVISION,
        transitionedAt: 102,
    });
}

describe('recordAgentRunReceiptSaga', () => {
    afterAll(() => {
        clearHandlerRegistry();
    });

    beforeEach(() => {
        agentRunLifecycle.clear();
        createRun();
    });

    it('persists a stem import reconciliation effect and blocks terminal completion', async () => {
        const stemEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: STEM_COMMAND.operation,
            reason: 'imported stem runtime reconciliation remains pending',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([stemEffect]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [stemEffect],
                    recovery: 'reconcile-batch',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        stepId: `effect:batch-agent-effects:${STEM_COMMAND.commandId}`,
                        owner: 'external-effect',
                        state: 'external-pending',
                    }),
                ]),
            },
        });
    });

    it('persists every effect in a mixed batch as one receipt-bound continuation', async () => {
        const runtimeEffect = {
            commandId: DEVICE_COMMAND.commandId,
            kind: 'runtime-graph' as const,
            operation: DEVICE_COMMAND.operation,
            reason: 'runtime graph revision is stale',
            remediation: 'repair' as const,
            state: 'pending' as const,
        };
        const stemEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: STEM_COMMAND.operation,
            reason: 'imported stem runtime reconciliation remains pending',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([runtimeEffect, stemEffect]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [runtimeEffect, stemEffect],
                    recovery: 'reconcile-batch',
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ stepId: `effect:batch-agent-effects:${runtimeEffect.commandId}` }),
                    expect.objectContaining({ stepId: `effect:batch-agent-effects:${stemEffect.commandId}` }),
                ]),
            },
        });
    });

    it('retains the exact continuation across a receipt-write crash without clearing independent restart work', async () => {
        const pendingEffect = {
            commandId: DEVICE_COMMAND.commandId,
            kind: 'runtime-graph' as const,
            operation: DEVICE_COMMAND.operation,
            reason: 'runtime graph repair remains pending',
            remediation: 'repair' as const,
            state: 'pending' as const,
        };
        const receipt = await createReceipt([pendingEffect]);
        expect(
            agentRunWorkLease.claim({
                runId: 'run-agent-effects',
                workId: 'batch-agent-effects',
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: 'command-batch',
                receiptIdentity: 'command:run-agent-effects:batch-agent-effects',
                idempotent: true,
                retriable: false,
                claimedAt: 103,
            }).status
        ).toBe('claimed');
        expect(
            agentRunWorkLease.claim({
                runId: 'run-agent-effects',
                workId: 'render-other',
                ownerKind: 'render',
                cleanupOwner: 'render-worker',
                idempotencyKey: 'render-other',
                receiptIdentity: 'render:other',
                idempotent: true,
                retriable: false,
                claimedAt: 104,
            }).status
        ).toBe('claimed');
        agentRunLifecycle.registerTemporaryAsset({
            runId: 'run-agent-effects',
            assetId: 'preview.wav',
            kind: 'render',
            cleanupOwner: 'render-worker',
            createdAt: 105,
        });
        recordAgentRunPendingEffectContinuation({
            runId: 'run-agent-effects',
            receipt,
            commandBatch: COMMAND_BATCH,
            recordedAt: 106,
        });
        vi.spyOn(agentRunLifecycle, 'recordCommittedWork').mockImplementation(() => {
            throw new Error('simulated crash before AgentRun receipt writes');
        });

        expect(() =>
            recordAgentRunReceiptSaga({
                runId: 'run-agent-effects',
                receipt,
                actions: ACTIONS,
                completesRun: true,
                commandBatch: COMMAND_BATCH,
            })
        ).toThrow('simulated crash before AgentRun receipt writes');
        await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
            recoveredRunIds: ['run-agent-effects'],
        });
        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'paused',
            manualResume: { required: true, workIds: ['render-other'] },
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [pendingEffect],
                    serializedBatch: COMMAND_BATCH.serialized,
                },
            ],
            temporaryAssets: [{ assetId: 'preview.wav', status: 'cleanup-pending' }],
            workLeases: [
                expect.objectContaining({ workId: 'batch-agent-effects', terminalState: 'orphaned' }),
                expect.objectContaining({ workId: 'render-other', terminalState: 'orphaned' }),
            ],
        });

        agentRunLifecycle.completePendingEffectContinuation({
            runId: 'run-agent-effects',
            batchId: 'batch-agent-effects',
            receiptIdentity: '1:run-agent-effects:batch-agent-effects:committed',
            completedAt: 201,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'paused',
            manualResume: { required: true, workIds: ['render-other'] },
            pendingEffectContinuations: [],
            temporaryAssets: [{ assetId: 'preview.wav', status: 'cleanup-pending' }],
        });
    });
});
