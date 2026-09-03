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

import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { agentRunStore, readAgentRunState } from '../../stores/agentRunStore';
import { selectAgentRunPendingEffectRecoveries } from '../../stores/selectAgentRunPendingEffectRecoveries';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
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
    const actions = COMMAND_ENVELOPE.commands.map((command, index) => {
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
    });
    return createVerifiedBatchReceipt({
        contentHash: proof.contentHash,
        envelope: COMMAND_ENVELOPE,
        observedBaseRevision: BASE_REVISION,
        resultingRevision: BASE_REVISION,
        result:
            pendingEffects.length > 0
                ? {
                      status: 'committed-with-warning',
                      warning: 'A post-commit effect remains pending.',
                      warningDetails: pendingEffects.map((pendingEffect) => ({
                          kind: 'external-effect',
                          message: pendingEffect.reason,
                          commandId: pendingEffect.commandId,
                          pendingEffect,
                      })),
                      actions,
                  }
                : {
                      status: 'committed',
                      actions,
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
                    recovery: 'manual-repair',
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

    it('moves only the external effect receipt step to manual repair', async () => {
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

        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-agent-effects',
            batchId: 'batch-agent-effects',
            reason: 'Manual reconciliation is required.',
            requiredAt: 200,
        });

        const steps = agentRunLifecycle.get('run-agent-effects')?.saga.steps ?? [];
        expect(steps.filter((step) => step.owner === 'command' || step.owner === 'import')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ state: 'committed' }),
                expect.objectContaining({ state: 'committed' }),
            ])
        );
        expect(steps.filter((step) => step.owner === 'external-effect')).toEqual([
            expect.objectContaining({ state: 'manual-repair', updatedAt: 200 }),
        ]);
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
                    recovery: 'manual-repair',
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

    it('binds the committed revision into a render-only continuation and clears its generic reason', async () => {
        const renderEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: 'renderProjectSections',
            reason: 'renderer unavailable',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([renderEffect]),
            actions: ACTIONS,
            committedRevision: BASE_REVISION,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            pendingEffectContinuations: [
                {
                    batchId: 'batch-agent-effects',
                    effects: [renderEffect],
                    recovery: 'reconcile-batch',
                    lastError: null,
                    sourceRevision: BASE_REVISION,
                },
            ],
        });
        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({
                batchId: 'batch-agent-effects',
                recovery: 'reconcile-batch',
            }),
        ]);
    });

    it('keeps a generic continuation on manual repair without binding a committed revision', async () => {
        const deviceEffect = {
            commandId: DEVICE_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: DEVICE_COMMAND.operation,
            reason: 'arrangement event bus is offline',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([deviceEffect]),
            actions: ACTIONS,
            committedRevision: BASE_REVISION,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        const continuation = agentRunLifecycle.get('run-agent-effects')?.pendingEffectContinuations[0];
        expect(continuation).toMatchObject({
            batchId: 'batch-agent-effects',
            effects: [deviceEffect],
            recovery: 'manual-repair',
            lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });
        expect(continuation).not.toHaveProperty('sourceRevision');
    });

    it('retains manual repair during an idempotent pending receipt replay until a final receipt settles it', async () => {
        const pendingEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: STEM_COMMAND.operation,
            reason: 'imported stem runtime reconciliation remains pending',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };
        const pendingReceipt = await createReceipt([pendingEffect]);
        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: pendingReceipt,
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });
        agentRunLifecycle.requirePendingEffectManualRepair({
            runId: 'run-agent-effects',
            batchId: 'batch-agent-effects',
            reason: 'Manual stem reconciliation is required.',
            requiredAt: 200,
        });

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: pendingReceipt,
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            pendingEffectContinuations: [
                expect.objectContaining({
                    recovery: 'manual-repair',
                    lastError: 'Manual stem reconciliation is required.',
                    effects: [expect.objectContaining({ remediation: 'manual-repair' })],
                }),
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'manual-repair' }),
                ]),
            },
        });
        expect(readAgentRunState().pendingEffectRecoveryLedger).toEqual([
            expect.objectContaining({
                recovery: 'manual-repair',
                lastError: 'Manual stem reconciliation is required.',
                effects: [expect.objectContaining({ remediation: 'manual-repair' })],
            }),
        ]);

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'completed',
            pendingEffectContinuations: [],
        });
        expect(readAgentRunState().pendingEffectRecoveryLedger).toBeUndefined();
    });

    it('heals a restart-crash ledger without a live continuation when the final receipt arrives', async () => {
        const pendingEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: STEM_COMMAND.operation,
            reason: 'imported stem runtime reconciliation remains pending',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };
        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([pendingEffect]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });
        const restartCrashState = readAgentRunState();
        agentRunStore.set({
            ...restartCrashState,
            runs: restartCrashState.runs.map((run) =>
                run.runId === 'run-agent-effects' ? { ...run, pendingEffectContinuations: [] } : run
            ),
        });

        recordAgentRunReceiptSaga({
            runId: 'run-agent-effects',
            receipt: await createReceipt([]),
            actions: ACTIONS,
            completesRun: true,
            commandBatch: COMMAND_BATCH,
        });

        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({
            phase: 'completed',
            pendingEffectContinuations: [],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'committed' }),
                ]),
            },
        });
        expect(readAgentRunState().pendingEffectRecoveryLedger).toBeUndefined();

        agentRunLifecycle.cancel({
            runId: 'run-agent-effects',
            reason: 'Cancellation raced with final receipt healing.',
        });
        expect(agentRunLifecycle.get('run-agent-effects')).toMatchObject({ phase: 'completed' });
    });

    it('projects import receipt facts identically through normal and atomic recovery settlement', async () => {
        const pendingEffect = {
            commandId: STEM_COMMAND.commandId,
            kind: 'external-effect' as const,
            operation: STEM_COMMAND.operation,
            reason: 'imported stem runtime reconciliation remains pending',
            remediation: 'reconcile' as const,
            state: 'pending' as const,
        };
        const receipt = await createReceipt([pendingEffect]);
        const now = vi.spyOn(Date, 'now').mockReturnValue(300);
        try {
            recordAgentRunReceiptSaga({
                runId: 'run-agent-effects',
                receipt,
                actions: ACTIONS,
                revertGroupId: 'batch-agent-effects',
                committedRevision: BASE_REVISION,
                completesRun: true,
                commandBatch: COMMAND_BATCH,
            });
            const normal = agentRunLifecycle.get('run-agent-effects');
            const normalLedger = readAgentRunState().pendingEffectRecoveryLedger;
            if (!normal) {
                throw new Error('Expected normal receipt settlement to retain its AgentRun.');
            }

            agentRunLifecycle.clear();
            createRun();
            agentRunLifecycle.recordCommittedRecoveryFailure({
                runId: 'run-agent-effects',
                receipt,
                actions: ACTIONS,
                revertGroupId: 'batch-agent-effects',
                committedRevision: BASE_REVISION,
                completesRun: true,
                commandBatch: COMMAND_BATCH,
                error: normalizeAgentFailure({
                    category: 'internal',
                    source: 'command-execution',
                    occurredAt: 300,
                    related: { receiptIdentities: ['receipt-recovery-failure'] },
                }),
            });
            const recovered = agentRunLifecycle.get('run-agent-effects');
            if (!recovered) {
                throw new Error('Expected atomic receipt settlement to retain its AgentRun.');
            }
            const { errors: _normalErrors, phase: _normalPhase, ...normalProjection } = normal;
            const { errors: _recoveredErrors, phase: _recoveredPhase, ...recoveredProjection } = recovered;

            expect(recoveredProjection).toEqual(normalProjection);
            expect(readAgentRunState().pendingEffectRecoveryLedger).toEqual(normalLedger);
            expect(recovered.saga.steps).toContainEqual(
                expect.objectContaining({ stepId: 'import:batch-agent-effects', owner: 'import' })
            );
        } finally {
            now.mockRestore();
        }
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
        vi.spyOn(agentRunLifecycle, 'recordReceiptSaga').mockImplementation(() => {
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
