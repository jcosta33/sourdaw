import { describe, it, expect, vi } from 'vitest';

const SAMPLE_RATE = 44100;

/**
 * A pure 440 Hz (A4) sine. The McLeod Pitch Method should report ~440 Hz with
 * high clarity, mapping to MIDI 69 / "A4".
 */
function toneA4Buffer(): { sampleRate: number; getChannelData: () => Float32Array } {
    const length = SAMPLE_RATE; // 1 second
    const data = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        data[index] = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
    }
    return { sampleRate: SAMPLE_RATE, getChannelData: () => data };
}

const toneA4 = toneA4Buffer();

// Production imports `audioBufferCache` from `#/modules/AudioEngine/stores`;
// the previous `#/modules/AudioEngine/useCases` mock was inert, so the
// detector read the real empty store and never ran the pitch tracker.
//
// `pitchy` is intentionally NOT mocked here: the happy-path test exercises the
// real McLeod Pitch Method against a synthesized tone.
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => (id === 'toneA4' ? toneA4 : null)),
    },
}));

import { trackPitch, detectDominantPitch } from '../pitchDetection';

describe('pitchDetection', () => {
    it('trackPitch returns an empty list when the buffer is missing', () => {
        expect(trackPitch('missing')).toEqual([]);
    });

    it('detectDominantPitch returns null when the buffer is missing', () => {
        expect(detectDominantPitch('missing')).toBeNull();
    });

    it('tracks A4 (440 Hz) across a pure tone', () => {
        // Exercises the real pitch-tracking pipeline: every detected frame of a
        // 440 Hz tone must read close to 440 Hz / MIDI 69.
        const results = trackPitch('toneA4');
        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
            expect(result.frequency).toBeGreaterThan(430);
            expect(result.frequency).toBeLessThan(450);
            expect(result.midiPitch).toBe(69);
        }
    });

    it('detectDominantPitch reports A4 for a pure 440 Hz tone', () => {
        const dominant = detectDominantPitch('toneA4');
        expect(dominant).not.toBeNull();
        expect(dominant?.midiPitch).toBe(69);
        expect(dominant?.noteName).toBe('A4');
    });
});
