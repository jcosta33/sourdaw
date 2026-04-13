import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setSamplerParam: vi.fn(),
    samplerStore: { value: null as any },
}));

vi.mock('../../repositories/samplerBridge', () => ({
    setSamplerParam: mocks.setSamplerParam,
}));

vi.mock('../../stores/samplerStore', () => ({
    samplerStore: mocks.samplerStore,
}));

// §57.1 / §33.2 — createRafBatcher schedules through rAF, which jsdom
// doesn't run synchronously. Replace the factory with one that flushes
// immediately so test assertions can observe the side effect.
vi.mock('#/utils/DOM/createRafBatcher', () => ({
    createRafBatcher: () => ({
        schedule: (key: string, value: unknown, flush: (k: string, v: unknown) => void) => {
            flush(key, value);
        },
        cancel: (): void => {},
        cancelAll: (): void => {},
        pendingSize: 0,
    }),
}));

import { setSamplerParamImmediate } from '../samplerParamBridge/setSamplerParamImmediate';
import { setSamplerParamThrottled } from '../samplerParamBridge/setSamplerParamThrottled';

describe('samplerParamBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('setSamplerParamImmediate forwards to IPC when an instance is active', () => {
        mocks.setSamplerParam.mockResolvedValue(undefined);
        mocks.samplerStore.value = { instanceId: 'inst-1' };

        setSamplerParamImmediate('gain', 0.5);

        expect(mocks.setSamplerParam).toHaveBeenCalledWith('inst-1', 'gain', 0.5);
    });

    it('setSamplerParamThrottled flushes to IPC on the next animation frame', () => {
        vi.stubGlobal(
            'requestAnimationFrame',
            (callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            }
        );
        mocks.setSamplerParam.mockResolvedValue(undefined);
        mocks.samplerStore.value = null;

        setSamplerParamThrottled('inst-2', 'gain', 0.25);

        expect(mocks.setSamplerParam).toHaveBeenCalledWith('inst-2', 'gain', 0.25);
    });
});
