import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { createCompressor } from '../dynamics/createCompressor';
import { createEq } from '../dynamics/createEq';
import { createLimiter } from '../dynamics/createLimiter';
import { createFilter } from '../toneShaping/createFilter';
import { createGainDevice } from '../toneShaping/createGainDevice';

describe('deviceFactories', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext() as any;
        vi.clearAllMocks();
    });

    it('should create a gain device', () => {
        const device = createGainDevice(ctx as any);
        expect(ctx.createGain).toHaveBeenCalled();
        expect(device.inputNode).toBe(device.outputNode);
        expect((device.inputNode as GainNode).gain.value).toBe(1);
    });

    it('should create a filter device', () => {
        const device = createFilter(ctx as any);
        expect(ctx.createBiquadFilter).toHaveBeenCalled();
        expect(device.inputNode).toBe(device.outputNode);
        expect((device.inputNode as BiquadFilterNode).type).toBe('lowpass');
    });

    it('should create a compressor device with makeup gain', () => {
        const device = createCompressor(ctx as any);

        expect(ctx.createDynamicsCompressor).toHaveBeenCalled();
        expect(ctx.createGain).toHaveBeenCalled();
        expect(device.nodes).toHaveLength(2);

        const comp = device.nodes[0] as DynamicsCompressorNode;
        expect(comp.threshold.value).toBe(-20);
        expect(comp.ratio.value).toBe(4);
    });

    it('should create a limiter device', () => {
        const device = createLimiter(ctx as any);

        expect(ctx.createDynamicsCompressor).toHaveBeenCalled();
        const comp = device.nodes[0] as DynamicsCompressorNode;
        expect(comp.threshold.value).toBe(-6);
        expect(comp.ratio.value).toBe(20);
    });

    it('should create an EQ device with 3 bands', () => {
        const device = createEq(ctx as any);

        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(3);
        expect(device.nodes).toHaveLength(3);

        const low = device.nodes[0] as BiquadFilterNode;
        const mid = device.nodes[1] as BiquadFilterNode;
        const high = device.nodes[2] as BiquadFilterNode;

        expect(low.type).toBe('peaking');
        expect(mid.type).toBe('peaking');
        expect(high.type).toBe('peaking');
    });
});
