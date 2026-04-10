import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setSamplerParamImmediate, setSamplerParamThrottled } from './samplerParamBridge';

describe('samplerParamBridge', () => {
    beforeEach(() => {
        Container.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('setSamplerParamImmediate forwards to IPC when an instance is active', () => {
        const setSamplerParam = vi.fn().mockResolvedValue(undefined);
        injectDependencies(setSamplerParamImmediate, {
            setSamplerParam,
            samplerStore: { value: { instanceId: 'inst-1' } } as never,
        });

        setSamplerParamImmediate('gain', 0.5);

        expect(setSamplerParam).toHaveBeenCalledWith('inst-1', 'gain', 0.5);
    });

    it('setSamplerParamThrottled flushes to IPC on the next animation frame', () => {
        vi.stubGlobal(
            'requestAnimationFrame',
            (callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            }
        );
        const setSamplerParam = vi.fn().mockResolvedValue(undefined);
        injectDependencies(setSamplerParamThrottled, {
            setSamplerParam,
            samplerStore: { value: null } as never,
        });

        setSamplerParamThrottled('inst-2', 'gain', 0.25);

        expect(setSamplerParam).toHaveBeenCalledWith('inst-2', 'gain', 0.25);
    });
});
