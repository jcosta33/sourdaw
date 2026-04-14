import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDelay } from '../reverbDelay/createDelay';
import { createReverb } from '../reverbDelay/createReverb';
import { createMockAudioContext, MockAudioBuffer } from '../../../../../helpers/__tests__/audioContext.mock';

vi.stubGlobal('AudioBuffer', MockAudioBuffer);

describe('reverbDelayFactories', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext() as any;
        vi.clearAllMocks();
    });

    it('should create a delay device with feedback filters', () => {
        const device = createDelay(ctx as any);
        expect(ctx.createDelay).toHaveBeenCalled();
        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(2);
        expect(device.nodes.length).toBe(8);
    });

    it('should create an algorithmic reverb device', () => {
        const device = createReverb(ctx as any);
        expect(ctx.createDelay).toHaveBeenCalled(); // pre-delay
        expect(ctx.createConvolver).toHaveBeenCalled();
        expect(ctx.createBiquadFilter).toHaveBeenCalled();
        expect(device.nodes.length).toBe(7);
    });
});
