import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleBuiltinSynthNote } from '../scheduleBuiltinSynthNote';
import { scheduleBuiltinSynthNoteOffline } from '../scheduleBuiltinSynthNoteOffline';

vi.mock('../scheduleBuiltinSynthNote', () => ({
    scheduleBuiltinSynthNote: vi.fn(),
}));

const ctx = {} as BaseAudioContext;
const destination = {} as AudioNode;
const params = {
    waveform: 'sawtooth',
    attack: 0.5,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5_000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 800,
    detune: 3,
    gain: 0.3,
    osc2Waveform: 'square',
    osc2Detune: 7,
    osc2Mix: 0.4,
    subOscLevel: 0.2,
    noiseLevel: 0.1,
    vibratoRate: 5,
    vibratoDepth: 9,
    vibratoDelay: 0.3,
    stereoSpread: 0.6,
    filterVelocitySensitivity: 0.5,
} satisfies Parameters<typeof scheduleBuiltinSynthNoteOffline>[0]['params'];

describe('scheduleBuiltinSynthNoteOffline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the full realtime graph with the same expression and clip gain', () => {
        const mpe = {
            pressure: 90,
            slide: 45,
            pitchBend: 4_096,
            pitchBendRangeSemitones: 12,
        };

        scheduleBuiltinSynthNoteOffline({
            ctx,
            destination,
            pitch: 69,
            startTime: 2,
            duration: 1.5,
            velocity: 100,
            params,
            mpe,
            clipGain: 0.25,
        });

        expect(scheduleBuiltinSynthNote).toHaveBeenCalledWith({
            ctx,
            destination,
            pitch: 69,
            startTime: 2,
            duration: 1.5,
            velocity: 100,
            params,
            mpe,
            clipGain: 0.25,
        });
    });
});
