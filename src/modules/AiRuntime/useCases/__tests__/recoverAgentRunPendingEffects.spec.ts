import { beforeEach, describe, expect, it, vi } from 'vitest';

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
                receiptIdentity: '2:run-render-recovery:batch-render-recovery:partially-committed',
            }),
        });
        expect(mocks.requireManualRepair).toHaveBeenCalledOnce();
    });

    it('reconciles a runtime-graph effect that happens to share the render operation name', async () => {
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
        mocks.executeBatch.mockResolvedValue({
            status: 'idempotent-replay',
            receipt: {
                schemaVersion: 2,
                runId: 'run-render-recovery',
                batchId: 'batch-render-recovery',
                outcome: 'committed',
                pendingEffects: [],
            },
        });

        await expect(
            recoverAgentRunPendingEffects({ runId: 'run-render-recovery', batchId: 'batch-render-recovery' })
        ).resolves.toEqual({ status: 'recovered' });

        expect(mocks.executeBatch).toHaveBeenCalledOnce();
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
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
