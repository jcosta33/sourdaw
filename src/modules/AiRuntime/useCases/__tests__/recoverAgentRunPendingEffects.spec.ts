import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentRunPendingEffect } from '../../models/AgentRun';
import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { recoverAgentRunPendingEffects } from '../recoverAgentRunPendingEffects';

const mocks = vi.hoisted(() => ({
    executeBatch: vi.fn(),
    completeRecovery: vi.fn(),
    failRecovery: vi.fn(),
    getRecovery: vi.fn(),
    getReceipt: vi.fn(),
    logError: vi.fn(),
    recordRecovery: vi.fn(),
    requireManualRepair: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.logError } }));

vi.mock('#/modules/Command/useCases', () => ({
    executeVersionedCommandBatchEnvelope: mocks.executeBatch,
    getVersionedCommandBatchIdempotentReplay: mocks.getReceipt,
}));

vi.mock('../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        completePendingEffectContinuation: mocks.completeRecovery,
        failPendingEffectContinuation: mocks.failRecovery,
        getPendingEffectRecovery: mocks.getRecovery,
        recordPendingEffectContinuation: mocks.recordRecovery,
        requirePendingEffectManualRepair: mocks.requireManualRepair,
    },
}));

function renderRecovery() {
    return {
        runId: 'run-render-recovery',
        batchId: 'batch-render-recovery',
        checkpoint: 'durable',
        effects: [
            {
                commandId: 'command-render',
                kind: 'external-effect',
                operation: 'renderProjectSections',
                reason: 'renderer unavailable',
                remediation: 'reconcile',
                state: 'pending',
            },
        ],
        recovery: 'reconcile-batch',
        receiptIdentity: '2:run-render-recovery:batch-render-recovery:partially-committed',
        serializedBatch: '{"batch":"render"}',
        authority: {},
        lastError: null,
    };
}

const PROVISIONAL_DURABLE_EFFECT_REASON = 'Post-commit effect has not completed';
const PENDING_EFFECT_PROOF_MISMATCH_REASON =
    'The durable project checkpoint does not match the retained pending-effect proof.';

function runtimeGraphReceiptEffect(commandId = 'command-runtime'): AgentRunPendingEffect {
    return {
        commandId,
        kind: 'runtime-graph',
        operation: 'addDevice',
        reason: 'runtime graph revision is stale',
        remediation: 'retry',
        state: 'pending',
    };
}

function manualizedRuntimeGraphEffect(receiptEffect: AgentRunPendingEffect): AgentRunPendingEffect {
    return {
        ...receiptEffect,
        kind: 'runtime-graph',
        reason: PROVISIONAL_DURABLE_EFFECT_REASON,
        remediation: 'repair',
    };
}

function configureManualizedRuntimeGraphProof(input?: {
    checkpoint?: 'prepared' | 'durable';
    continuationEffects?: AgentRunPendingEffect[];
    receiptEffects?: AgentRunPendingEffect[];
    lastError?: string | null;
    recovery?: 'reconcile-batch' | 'manual-repair';
}): void {
    const receiptEffect = runtimeGraphReceiptEffect();
    const recovery = renderRecovery();
    mocks.getRecovery.mockReturnValue({
        ...recovery,
        checkpoint: input?.checkpoint ?? 'durable',
        effects: input?.continuationEffects ?? [manualizedRuntimeGraphEffect(receiptEffect)],
        lastError: input?.lastError ?? MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        recovery: input?.recovery ?? 'manual-repair',
    });
    mocks.getReceipt.mockResolvedValue({
        schemaVersion: 2,
        runId: 'run-render-recovery',
        batchId: 'batch-render-recovery',
        outcome: 'partially-committed',
        pendingEffects: input?.receiptEffects ?? [receiptEffect],
    });
}

describe('recoverAgentRunPendingEffects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRecovery.mockReturnValue(renderRecovery());
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'partially-committed',
            pendingEffects: [renderRecovery().effects[0]],
        });
    });
    it('refuses a still-pending generic section-render recovery before execution', async () => {
        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.',
        });
        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: 'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.',
            preserveEffects: false,
        });
        expect(mocks.getReceipt).toHaveBeenCalledOnce();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('promotes a prepared render continuation before making it visible as manual repair', async () => {
        const prepared = { ...renderRecovery(), checkpoint: 'prepared' as const };
        mocks.getRecovery.mockReturnValueOnce(prepared).mockReturnValueOnce({ ...prepared, checkpoint: 'durable' });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toMatchObject({ status: 'failed' });

        expect(mocks.recordRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            continuation: expect.objectContaining({
                batchId: 'batch-render-recovery',
                effects: renderRecovery().effects,
                recovery: 'manual-repair',
                receiptIdentity: '2:run-render-recovery:batch-render-recovery:partially-committed',
            }),
        });
        expect(mocks.requireManualRepair).toHaveBeenCalledOnce();
    });

    it('refuses runtime-graph recovery without exact checkpoint evidence', async () => {
        const recovery = renderRecovery();
        const runtimeGraphEffect = {
            ...recovery.effects[0],
            kind: 'runtime-graph' as const,
            remediation: 'retry' as const,
        };
        mocks.getRecovery.mockReturnValue({ ...recovery, effects: [runtimeGraphEffect] });
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'partially-committed',
            pendingEffects: [runtimeGraphEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });

        expect(mocks.executeBatch).not.toHaveBeenCalled();
        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            preserveEffects: true,
        });
    });

    it('admits the exact manualized durable runtime-graph binding without executing recovery', async () => {
        const recovery = renderRecovery();
        const receiptEffect = {
            ...recovery.effects[0],
            kind: 'runtime-graph' as const,
            remediation: 'retry' as const,
        };
        mocks.getRecovery.mockReturnValue({
            ...recovery,
            effects: [{ ...receiptEffect, remediation: 'repair' as const }],
            lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            recovery: 'manual-repair',
        });
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'partially-committed',
            pendingEffects: [receiptEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });

        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            preserveEffects: true,
        });
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('admits the established provisional runtime-graph reason only when the receipt supplies the final reason', async () => {
        const recovery = renderRecovery();
        const receiptEffect = {
            ...recovery.effects[0],
            kind: 'runtime-graph' as const,
            reason: 'runtime graph revision is stale',
            remediation: 'retry' as const,
        };
        mocks.getRecovery.mockReturnValue({
            ...recovery,
            effects: [
                {
                    ...receiptEffect,
                    reason: 'Post-commit effect has not completed',
                    remediation: 'repair' as const,
                },
            ],
            lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            recovery: 'manual-repair',
        });
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'partially-committed',
            pendingEffects: [receiptEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });

        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            preserveEffects: true,
        });
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('admits a provisional repair when the final runtime-graph receipt also requires repair', async () => {
        const receiptEffect: AgentRunPendingEffect = {
            commandId: 'command-runtime',
            kind: 'runtime-graph',
            operation: 'addDevice',
            reason: 'runtime graph revision is stale',
            remediation: 'repair',
            state: 'pending',
        };
        configureManualizedRuntimeGraphProof({
            continuationEffects: [manualizedRuntimeGraphEffect(receiptEffect)],
            receiptEffects: [receiptEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({ status: 'failed', reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON });

        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            preserveEffects: true,
        });
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('admits an exact effect beside one manualized runtime-graph effect without executing', async () => {
        const manualRepairReason =
            'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.';
        const exactEffect: AgentRunPendingEffect = {
            commandId: 'command-render',
            kind: 'external-effect',
            operation: 'renderProjectSections',
            reason: 'renderer unavailable',
            remediation: 'reconcile',
            state: 'pending',
        };
        const receiptRuntimeEffect: AgentRunPendingEffect = {
            commandId: 'command-runtime',
            kind: 'runtime-graph',
            operation: 'addDevice',
            reason: 'runtime graph revision is stale',
            remediation: 'retry',
            state: 'pending',
        };
        configureManualizedRuntimeGraphProof({
            continuationEffects: [exactEffect, manualizedRuntimeGraphEffect(receiptRuntimeEffect)],
            receiptEffects: [exactEffect, receiptRuntimeEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({ status: 'failed', reason: manualRepairReason });

        expect(mocks.requireManualRepair).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: manualRepairReason,
            preserveEffects: false,
        });
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('rejects a manualized runtime-graph binding with any other changed continuation reason', async () => {
        const recovery = renderRecovery();
        const receiptEffect = {
            ...recovery.effects[0],
            kind: 'runtime-graph' as const,
            remediation: 'retry' as const,
        };
        mocks.getRecovery.mockReturnValue({
            ...recovery,
            effects: [{ ...receiptEffect, reason: 'tampered reason', remediation: 'repair' as const }],
            lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            recovery: 'manual-repair',
        });
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'partially-committed',
            pendingEffects: [receiptEffect],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });

        expect(mocks.failRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it.each([
        [
            'wrong last error',
            () => configureManualizedRuntimeGraphProof({ lastError: 'different recovery policy' }),
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'extra receipt effect',
            () => {
                const first = runtimeGraphReceiptEffect('command-runtime-first');
                const second = runtimeGraphReceiptEffect('command-runtime-second');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(first)],
                    receiptEffects: [first, second],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'swapped effect order',
            () => {
                const first = runtimeGraphReceiptEffect('command-runtime-first');
                const second = runtimeGraphReceiptEffect('command-runtime-second');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(second), manualizedRuntimeGraphEffect(first)],
                    receiptEffects: [first, second],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong continuation kind',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                const continuationEffect = manualizedRuntimeGraphEffect(receiptEffect);
                Reflect.set(continuationEffect, 'kind', 'external-effect');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [continuationEffect],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong receipt kind',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                Reflect.set(receiptEffect, 'kind', 'external-effect');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(runtimeGraphReceiptEffect())],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong continuation operation',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [{ ...manualizedRuntimeGraphEffect(receiptEffect), operation: 'setTrackPan' }],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong receipt operation',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(receiptEffect)],
                    receiptEffects: [{ ...receiptEffect, operation: 'setTrackPan' }],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong continuation remediation',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                const continuationEffect = manualizedRuntimeGraphEffect(receiptEffect);
                Reflect.set(continuationEffect, 'remediation', 'retry');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [continuationEffect],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong receipt remediation',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                Reflect.set(receiptEffect, 'remediation', 'reconcile');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(receiptEffect)],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong continuation state',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                const continuationEffect = manualizedRuntimeGraphEffect(receiptEffect);
                Reflect.set(continuationEffect, 'state', 'settled');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [continuationEffect],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'wrong receipt state',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                const continuationEffect = manualizedRuntimeGraphEffect(receiptEffect);
                Reflect.set(receiptEffect, 'state', 'settled');
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [continuationEffect],
                    receiptEffects: [receiptEffect],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'receipt reason remains provisional',
            () => {
                const receiptEffect = runtimeGraphReceiptEffect();
                configureManualizedRuntimeGraphProof({
                    continuationEffects: [manualizedRuntimeGraphEffect(receiptEffect)],
                    receiptEffects: [{ ...receiptEffect, reason: PROVISIONAL_DURABLE_EFFECT_REASON }],
                });
            },
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'prepared checkpoint',
            () => configureManualizedRuntimeGraphProof({ checkpoint: 'prepared' }),
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
        [
            'non-manual recovery policy',
            () => configureManualizedRuntimeGraphProof({ recovery: 'reconcile-batch' }),
            PENDING_EFFECT_PROOF_MISMATCH_REASON,
        ],
    ])('rejects the manualized runtime-graph exception with %s', async (_label, configureProof, expectedReason) => {
        configureProof();

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({ status: 'failed', reason: expectedReason });

        expect(mocks.failRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: expectedReason,
        });
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('remains non-executable when manual-repair persistence fails', async () => {
        const persistenceFailure = new Error('persistence unavailable');
        mocks.requireManualRepair.mockImplementation(() => {
            throw persistenceFailure;
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toMatchObject({
            status: 'failed',
            reason: expect.stringContaining('original confirmation is required and may be unavailable after reload'),
        });
        expect(mocks.getReceipt).toHaveBeenCalledOnce();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
        expect(mocks.logError.mock.calls[0]?.[0]).toEqual(
            new Error('Pending-effect manual-repair state could not be persisted', { cause: persistenceFailure })
        );
    });

    it('clears a stale render continuation from an already-finalized Command receipt', async () => {
        mocks.getReceipt.mockResolvedValue({
            schemaVersion: 2,
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            outcome: 'committed',
            pendingEffects: [],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({ status: 'recovered' });
        expect(mocks.completeRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            receiptIdentity: '2:run-render-recovery:batch-render-recovery:committed',
        });
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('rejects continuation effects that do not match the durable pending receipt', async () => {
        mocks.getRecovery.mockReturnValue({
            ...renderRecovery(),
            effects: [{ ...renderRecovery().effects[0], operation: 'setTrackPan' }],
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });
        expect(mocks.failRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it.each([
        ['serialized batch', { ...renderRecovery(), serializedBatch: '{not-json' }],
        ['authority', { ...renderRecovery(), authority: { projectId: 'tampered-project' } }],
    ])('fails closed when the retained %s cannot load a verified receipt', async (_label, continuation) => {
        mocks.getRecovery.mockReturnValue(continuation);
        mocks.getReceipt.mockRejectedValue(new Error('receipt verification rejected the retained proof'));

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'The durable commit evidence for this pending-effect continuation could not be read: receipt verification rejected the retained proof',
        });
        expect(mocks.completeRecovery).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it.each([
        [
            'pending verified receipt',
            { ...renderRecovery(), receiptIdentity: '2:run-render-recovery:batch-render-recovery:committed' },
            {
                schemaVersion: 2,
                runId: 'run-render-recovery',
                batchId: 'batch-render-recovery',
                outcome: 'partially-committed',
                pendingEffects: [renderRecovery().effects[0]],
            },
        ],
        [
            'already-finalized verified receipt',
            { ...renderRecovery(), receiptIdentity: '2:run-render-recovery:batch-render-recovery:committed' },
            {
                schemaVersion: 2,
                runId: 'run-render-recovery',
                batchId: 'batch-render-recovery',
                outcome: 'committed',
                pendingEffects: [],
            },
        ],
    ])('rejects a tampered receipt identity against an %s', async (_label, continuation, receipt) => {
        mocks.getRecovery.mockReturnValue(continuation);
        mocks.getReceipt.mockResolvedValue(receipt);

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });
        expect(mocks.failRecovery).toHaveBeenCalledWith({
            runId: 'run-render-recovery',
            batchId: 'batch-render-recovery',
            reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
        });
        expect(mocks.completeRecovery).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });
});
