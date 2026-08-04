import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { createReverb } from '../createReverb';

function getConvolverBuffer(nodes: AudioNode[]): AudioBuffer {
    const convolver = nodes.find((node): node is ConvolverNode => 'buffer' in node);
    if (!convolver?.buffer) {
        throw new Error('Expected the reverb graph to contain a convolver buffer');
    }
    return convolver.buffer;
}

describe('createReverb', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reuses one deterministic stereo impulse for every reverb in the same context', () => {
        vi.stubGlobal('AudioBuffer', MockAudioBuffer);
        const ctx = createMockAudioContext();
        const otherCtx = createMockAudioContext();
        const random = vi.spyOn(Math, 'random');

        const firstReverb = createReverb(asBaseAudioContext(ctx));
        const secondReverb = createReverb(asBaseAudioContext(ctx));
        const otherContextReverb = createReverb(asBaseAudioContext(otherCtx));

        const firstImpulse = getConvolverBuffer(firstReverb.nodes);
        const secondImpulse = getConvolverBuffer(secondReverb.nodes);
        const otherContextImpulse = getConvolverBuffer(otherContextReverb.nodes);
        expect(ctx.createBuffer).toHaveBeenCalledOnce();
        expect(ctx.createBuffer).toHaveBeenCalledWith(2, ctx.sampleRate * 2, ctx.sampleRate);
        expect(otherCtx.createBuffer).toHaveBeenCalledOnce();
        expect(firstImpulse).toBe(secondImpulse);
        expect(firstImpulse).not.toBe(otherContextImpulse);
        expect(firstImpulse.getChannelData(0)).toEqual(otherContextImpulse.getChannelData(0));
        expect(firstImpulse.getChannelData(1)).toEqual(otherContextImpulse.getChannelData(1));
        expect(random).not.toHaveBeenCalled();
        expect(firstImpulse.getChannelData(0)).not.toEqual(firstImpulse.getChannelData(1));
    });
});
