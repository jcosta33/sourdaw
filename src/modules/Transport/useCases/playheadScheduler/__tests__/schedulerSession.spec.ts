import { describe, it, expect, vi } from 'vitest';

import { stopActiveSources, type SourceWithFade } from '../schedulerSession';

type MockGainParam = {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
};

function makeGainParam(value: number): MockGainParam {
    return {
        value,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
    };
}

const ctx = { currentTime: 10 } as BaseAudioContext;

describe('stopActiveSources', () => {
    it('ramps the fade gain down to zero and stops a source that has a fade gain node', () => {
        const gain = makeGainParam(0.8);
        const source = { stop: vi.fn(), fadeGainNode: { gain } } as unknown as SourceWithFade;
        const sources = [source] as unknown as AudioBufferSourceNode[];

        stopActiveSources(sources, ctx);

        expect(gain.cancelScheduledValues).toHaveBeenCalledWith(10);
        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.8, 10);
        expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.005);
        expect(source.stop).toHaveBeenCalledWith(10.005);
    });

    it('stops a source without a fade gain node directly, with no ramp', () => {
        const source = { stop: vi.fn() } as unknown as SourceWithFade;
        const sources = [source] as unknown as AudioBufferSourceNode[];

        stopActiveSources(sources, ctx);

        expect(source.stop).toHaveBeenCalledWith(10.005);
    });

    it('swallows an already-stopped source error without throwing', () => {
        const source = {
            stop: vi.fn(() => {
                throw new Error('already stopped');
            }),
        } as unknown as SourceWithFade;
        const sources = [source] as unknown as AudioBufferSourceNode[];

        expect(() => stopActiveSources(sources, ctx)).not.toThrow();
        expect(source.stop).toHaveBeenCalledTimes(1);
    });

    it('stops every source in the pool and clears the array afterward', () => {
        const first = { stop: vi.fn() } as unknown as SourceWithFade;
        const second = { stop: vi.fn() } as unknown as SourceWithFade;
        const sources = [first, second] as unknown as AudioBufferSourceNode[];

        stopActiveSources(sources, ctx);

        expect(first.stop).toHaveBeenCalledTimes(1);
        expect(second.stop).toHaveBeenCalledTimes(1);
        expect(sources).toHaveLength(0);
    });
});
