import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setVcaRuntimeProjectionDependencies } from '../../../useCases/vca/vcaRuntimeProjectionDependencies';
import { toVcaGainExecutionResult } from '../toVcaGainExecutionResult';

const mocks = vi.hoisted(() => ({ reconcileVcaRuntimeGain: vi.fn() }));

describe('toVcaGainExecutionResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setVcaRuntimeProjectionDependencies({
            reconcileVcaRuntimeGain: mocks.reconcileVcaRuntimeGain,
        });
    });

    afterEach(() => {
        setVcaRuntimeProjectionDependencies(null);
    });

    it('defers deduplicated runtime reconciliation until commit resolution', async () => {
        const result = toVcaGainExecutionResult({
            groupIds: ['vca-drums', 'vca-drums'],
            trackIds: ['track-kick', 'track-kick'],
            status: 'written',
        });

        expect(mocks.reconcileVcaRuntimeGain).not.toHaveBeenCalled();
        await result.afterCommit?.();
        await result.afterAmbiguousCommit?.();
        expect(mocks.reconcileVcaRuntimeGain).toHaveBeenNthCalledWith(1, {
            groupIds: ['vca-drums'],
            trackIds: ['track-kick'],
        });
        expect(mocks.reconcileVcaRuntimeGain).toHaveBeenNthCalledWith(2, {
            groupIds: ['vca-drums'],
            trackIds: ['track-kick'],
        });
    });

    it('does not schedule runtime work for no-write or conflict outcomes', () => {
        expect(toVcaGainExecutionResult({ groupIds: ['vca-drums'], status: 'no-write' })).toEqual({
            status: 'no-write',
        });
        expect(toVcaGainExecutionResult({ groupIds: ['vca-drums'], status: 'conflict' })).toEqual({
            status: 'conflict',
        });
        expect(mocks.reconcileVcaRuntimeGain).not.toHaveBeenCalled();
    });

    it('does not schedule runtime work when a durable write has no affected runtime targets', () => {
        expect(toVcaGainExecutionResult({ status: 'written' })).toEqual({ status: 'written' });
        expect(mocks.reconcileVcaRuntimeGain).not.toHaveBeenCalled();
    });
});
