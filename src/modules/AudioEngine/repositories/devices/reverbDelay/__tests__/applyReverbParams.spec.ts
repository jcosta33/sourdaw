import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    MockAudioBuffer,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applyReverbParams } from '../applyReverbParams';
import { createReverb } from '../createReverb';
import { DEFAULT_REVERB_SHAPE } from '../reverbImpulse';

beforeEach(() => {
    vi.stubGlobal('AudioBuffer', MockAudioBuffer);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function mockAudioParam(initial = 0) {
    return { value: initial };
}

describe('applyReverbParams', () => {
    it('should map reverb param keys onto dry, wet, predelay, and lowcut', () => {
        const splitter = {};
        const dry = { gain: mockAudioParam(0.7) };
        const wet = { gain: mockAudioParam(0.3) };
        const convolver = {};
        const merger = {};
        const predelay = { delayTime: mockAudioParam(0.01) };
        const lowcut = { frequency: mockAudioParam(80) };
        const dn: OfflineDeviceNode = {
            inputNode: splitter as GainNode,
            outputNode: merger as GainNode,
            nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut] as OfflineDeviceNode['nodes'],
        };

        applyReverbParams(dn, {
            'rev-mix': 0.65,
            'rev-predelay': 40,
            'rev-lowcut': 120,
        });

        expect(wet.gain.value).toBe(0.65);
        expect(dry.gain.value).toBeCloseTo(0.35, 5);
        expect(predelay.delayTime.value).toBe(0.04);
        expect(lowcut.frequency.value).toBe(120);
    });

    it('rebuilds the convolver impulse when rev-size, rev-decay or rev-damping move', () => {
        const ctx = createMockAudioContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        const convolver = dn.namedNodes!.convolver as ConvolverNode;
        const defaultBuffer = convolver.buffer;
        expect(defaultBuffer).not.toBeNull();
        // Descriptor default decay is 2 s at a 48 kHz mock context.
        expect(defaultBuffer!.length).toBe(ctx.sampleRate * DEFAULT_REVERB_SHAPE.decay);

        applyReverbParams(dn, { 'rev-decay': 5 });
        expect(convolver.buffer!.length).toBe(ctx.sampleRate * 5);
        expect(convolver.buffer).not.toBe(defaultBuffer);

        applyReverbParams(dn, { 'rev-size': 1 });
        expect(convolver.buffer).not.toBe(defaultBuffer);

        applyReverbParams(dn, { 'rev-damping': 0 });
        expect(convolver.buffer).not.toBe(defaultBuffer);
    });

    it('leaves the impulse alone when no shape parameter is present', () => {
        const ctx = createMockAudioContext();
        const dn = createReverb(asBaseAudioContext(ctx));
        const convolver = dn.namedNodes!.convolver as ConvolverNode;
        const before = convolver.buffer;

        applyReverbParams(dn, { 'rev-mix': 0.4, 'rev-predelay': 20, 'rev-lowcut': 150 });

        expect(convolver.buffer).toBe(before);
    });
});
