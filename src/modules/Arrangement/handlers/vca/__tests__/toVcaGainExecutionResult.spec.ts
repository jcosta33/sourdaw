import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setVcaRuntimeProjectionDependencies } from '../../../useCases/vca/vcaRuntimeProjectionDependencies';
import { toVcaGainExecutionResult } from '../toVcaGainExecutionResult';

const mocks = vi.hoisted(() => ({ reconcileVcaGroupRuntimeGain: vi.fn() }));

describe('toVcaGainExecutionResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setVcaRuntimeProjectionDependencies({
            reconcileVcaGroupRuntimeGain: mocks.reconcileVcaGroupRuntimeGain,
        });
    });

    afterEach(() => {
        setVcaRuntimeProjectionDependencies(null);
    });

    it('defers deduplicated runtime reconciliation until commit resolution', async () => {
        const result = toVcaGainExecutionResult({
            groupIds: ['vca-drums', 'vca-drums'],
            status: 'written',
        });

        expect(mocks.reconcileVcaGroupRuntimeGain).not.toHaveBeenCalled();
        await result.afterCommit?.();
        await result.afterAmbiguousCommit?.();
        expect(mocks.reconcileVcaGroupRuntimeGain).toHaveBeenNthCalledWith(1, 'vca-drums');
        expect(mocks.reconcileVcaGroupRuntimeGain).toHaveBeenNthCalledWith(2, 'vca-drums');
    });

    it('does not schedule runtime work for no-write or conflict outcomes', () => {
        expect(toVcaGainExecutionResult({ groupIds: ['vca-drums'], status: 'no-write' })).toEqual({
            status: 'no-write',
        });
        expect(toVcaGainExecutionResult({ groupIds: ['vca-drums'], status: 'conflict' })).toEqual({
            status: 'conflict',
        });
        expect(mocks.reconcileVcaGroupRuntimeGain).not.toHaveBeenCalled();
    });
});
