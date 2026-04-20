import { describe, it, expect } from 'vitest';

import { type OfflineDeviceNode } from '../../types';
import { applyDelayParams } from '../applyDelayParams';

function mockAudioParam(initial = 0) {
    return { value: initial };
}

describe('applyDelayParams', () => {
    it('should map delay param keys onto the delay graph nodes', () => {
        const splitter = {};
        const dry = { gain: mockAudioParam(0.7) };
        const wet = { gain: mockAudioParam(0.3) };
        const delay = { delayTime: mockAudioParam(0.25) };
        const feedback = { gain: mockAudioParam(0.4) };
        const merger = {};
        const fbLowcut = { frequency: mockAudioParam(80) };
        const fbHighcut = { frequency: mockAudioParam(12000) };
        const dn: OfflineDeviceNode = {
            inputNode: splitter as GainNode,
            outputNode: merger as GainNode,
            nodes: [splitter, dry, wet, delay, feedback, merger, fbLowcut, fbHighcut] as OfflineDeviceNode['nodes'],
        };

        applyDelayParams(dn, {
            'delay-time': 500,
            'delay-feedback': 0.55,
            'delay-lowcut': 100,
            'delay-highcut': 8000,
            'delay-mix': 0.6,
        });

        expect(delay.delayTime.value).toBe(0.5);
        expect(feedback.gain.value).toBe(0.55);
        expect(fbLowcut.frequency.value).toBe(100);
        expect(fbHighcut.frequency.value).toBe(8000);
        expect(wet.gain.value).toBe(0.6);
        expect(dry.gain.value).toBe(0.4);
    });
});
