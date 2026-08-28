import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverAgentRunPendingEffects } from '../recoverAgentRunPendingEffects';

const mocks = vi.hoisted(() => ({
    executeBatch: vi.fn(),
    completeRecovery: vi.fn(),
    failRecovery: vi.fn(),
    getRecovery: vi.fn(),
    getReceipt: vi.fn(),
    logError: vi.fn(),
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
        ['pending receipt', 'serialized batch', { ...renderRecovery(), serializedBatch: '{not-json' }],
        ['pending receipt', 'authority', { ...renderRecovery(), authority: { projectId: 'tampered-project' } }],
        ['finalized receipt', 'serialized batch', { ...renderRecovery(), serializedBatch: '{not-json' }],
        ['finalized receipt', 'authority', { ...renderRecovery(), authority: { projectId: 'tampered-project' } }],
    ])('fails closed when the retained %s %s is tampered', async (_receiptState, _label, continuation) => {
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
});
