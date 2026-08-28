import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverAgentRunPendingEffects } from '../recoverAgentRunPendingEffects';

const mocks = vi.hoisted(() => ({
    executeBatch: vi.fn(),
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
        receiptIdentity: 'receipt-render',
        serializedBatch: '{"batch":"render"}',
        authority: {},
        lastError: null,
    };
}

describe('recoverAgentRunPendingEffects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRecovery.mockReturnValue(renderRecovery());
    });

    it('refuses generic section-render recovery before receipt lookup or execution', async () => {
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
        expect(mocks.getReceipt).not.toHaveBeenCalled();
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
        expect(mocks.getReceipt).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
        expect(mocks.logError.mock.calls[0]?.[0]).toEqual(
            new Error('Pending-effect manual-repair state could not be persisted', { cause: persistenceFailure })
        );
    });
});
