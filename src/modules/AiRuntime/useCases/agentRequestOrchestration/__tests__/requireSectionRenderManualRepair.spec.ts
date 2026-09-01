import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireSectionRenderManualRepair } from '../requireSectionRenderManualRepair';

const mocks = vi.hoisted(() => ({
    logError: vi.fn(),
    requireManualRepair: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.logError } }));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: { requirePendingEffectManualRepair: mocks.requireManualRepair },
}));

const INPUT = {
    runId: 'run-render-review',
    batchId: 'batch-render-review',
    reason: 'Section render artifacts require manual review: render-verse (tail truncated).',
};

describe('requireSectionRenderManualRepair', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns no warning after durable manual-repair state is recorded', () => {
        expect(requireSectionRenderManualRepair(INPUT)).toBeNull();
        expect(mocks.requireManualRepair).toHaveBeenCalledWith(INPUT);
        expect(mocks.logError).not.toHaveBeenCalled();
    });

    it('returns the durability warning and logs persistence failure', () => {
        const persistenceFailure = new Error('agent run state could not be persisted');
        mocks.requireManualRepair.mockImplementation(() => {
            throw persistenceFailure;
        });

        expect(requireSectionRenderManualRepair(INPUT)).toBe(
            'The retained render manual-repair state could not be persisted. Do not reconcile or replay this committed batch until durable run state is repaired.'
        );
        expect(mocks.requireManualRepair).toHaveBeenCalledWith(INPUT);
        expect(mocks.logError).toHaveBeenCalledOnce();
        expect(mocks.logError.mock.calls[0]?.[0]).toEqual(
            new Error('Agent render manual-repair state could not be persisted', { cause: persistenceFailure })
        );
    });
});
