import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { createAutoPan } from '../modulation/createAutoPan';
import { createChorus } from '../modulation/createChorus';
import { createFlanger } from '../modulation/createFlanger';
import { createPhaser } from '../modulation/createPhaser';
import { createTremolo } from '../modulation/createTremolo';

describe('modulationFactories', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        vi.clearAllMocks();
    });

    it('should create a chorus device', () => {
        const device = createChorus(ctx as any);
        expect(ctx.createGain).toHaveBeenCalled();
        expect(ctx.createDelay).toHaveBeenCalledTimes(2);
        expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
        expect(device.nodes.length).toBeGreaterThan(0);
    });

    it('should create a phaser device', () => {
        const device = createPhaser(ctx as any);
        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(4);
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(device.namedNodes).toHaveProperty('lfo');
    });

    it('should create a flanger device', () => {
        const device = createFlanger(ctx as any);
        expect(ctx.createDelay).toHaveBeenCalled();
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(device.namedNodes).toHaveProperty('feedback');
    });

    it('should create a tremolo device', () => {
        const device = createTremolo(ctx as any);
        expect(ctx.createGain).toHaveBeenCalled();
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(device.namedNodes).toHaveProperty('lfo');
    });

    it('should create an autopan device', () => {
        const device = createAutoPan(ctx as any);
        expect(ctx.createChannelSplitter).toHaveBeenCalled();
        expect(ctx.createChannelMerger).toHaveBeenCalled();
        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(device.namedNodes).toHaveProperty('lfo');
    });
});
