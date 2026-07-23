import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { createStereoWidener } from '../modulation/createStereoWidener';

describe('createStereoWidener', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        vi.clearAllMocks();
    });

    it('creates a mid/side stereo-widener device graph', () => {
        const device = createStereoWidener(ctx as never);
        // Splitter + merger for the M/S matrix.
        expect(ctx.createChannelSplitter).toHaveBeenCalledTimes(1);
        expect(ctx.createChannelMerger).toHaveBeenCalledTimes(1);
        // Exactly 11 nodes in the device graph.
        expect(device.nodes).toHaveLength(11);
    });

    it('creates exactly 8 gain nodes for the mid/side matrix', () => {
        createStereoWidener(ctx as never);
        // input, output, midSum, sideSum, rightInvert, midGain, sideGain, sideInvert.
        expect(ctx.createGain).toHaveBeenCalledTimes(8);
    });

    it('creates one highpass biquad filter for the mono-bass side path', () => {
        createStereoWidener(ctx as never);
        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(1);
    });

    it('configures the M/S decode matrix gain signs and filter cutoff', () => {
        const device = createStereoWidener(ctx as never);
        // The factory always populates namedNodes.
        const namedNodes = device.namedNodes!;
        const gainNode = (key: string): { value: number } =>
            (namedNodes[key] as unknown as { gain: { value: number } }).gain;
        // Mid/side sum gains are 0.5.
        expect(gainNode('midSum').value).toBe(0.5);
        expect(gainNode('sideSum').value).toBe(0.5);
        // The right-invert and side-invert gains are -1 (sign-flip for subtraction).
        expect(gainNode('rightInvert').value).toBe(-1);
        expect(gainNode('sideInvert').value).toBe(-1);
        // The mono-bass filter is a highpass at 200 Hz.
        const filter = namedNodes.monoBassFilter as unknown as { type: string; frequency: { value: number } };
        expect(filter.type).toBe('highpass');
        expect(filter.frequency.value).toBe(200);
    });

    it('exposes named nodes for mid/side width control and the bass filter', () => {
        const device = createStereoWidener(ctx as never);
        expect(device.namedNodes).toHaveProperty('midGain');
        expect(device.namedNodes).toHaveProperty('sideGain');
        expect(device.namedNodes).toHaveProperty('monoBassFilter');
        expect(device.namedNodes).toHaveProperty('input');
        expect(device.namedNodes).toHaveProperty('output');
    });

    it('returns input and output nodes for graph wiring', () => {
        const device = createStereoWidener(ctx as never);
        expect(device.inputNode).toBeDefined();
        expect(device.outputNode).toBeDefined();
        expect(device.inputNode).not.toBe(device.outputNode);
    });
});
