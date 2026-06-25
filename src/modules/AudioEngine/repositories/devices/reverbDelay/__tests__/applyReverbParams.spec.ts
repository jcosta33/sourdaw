import { describe, it, expect } from 'vitest';

import { type OfflineDeviceNode } from '../../types';
import { applyReverbParams } from '../applyReverbParams';

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

    it('does not consume rev-decay (gated on Architecture-decision #1)', () => {
        // The builtin reverb has no decay param yet, so `applyReverbParams`
        // deliberately has no `rev-decay` branch. This test pins that boundary:
        // if real decay support lands (Architecture-decision #1), wire it here and
        // re-add the adjustment-layer `Decay` map entry in the same change. Until
        // then nothing may emit `rev-decay` into this device expecting an effect.
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

        applyReverbParams(dn, { 'rev-decay': 5 });

        expect(dry.gain.value).toBe(0.7);
        expect(wet.gain.value).toBe(0.3);
        expect(predelay.delayTime.value).toBe(0.01);
        expect(lowcut.frequency.value).toBe(80);
    });
});
