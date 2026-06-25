import { describe, it, expect, vi } from 'vitest';

const SAMPLE_RATE = 44100;

/** All-zero one-second buffer: no onsets, so detectTempo bails out. */
function silentBuffer(): { sampleRate: number; getChannelData: () => Float32Array } {
    return { sampleRate: SAMPLE_RATE, getChannelData: () => new Float32Array(SAMPLE_RATE).fill(0) };
}

/**
 * Synthesize evenly spaced energy bursts at a known tempo so the onset
 * detector finds a stable inter-onset interval. `bpm` beats per minute over
 * `seconds`, each beat a short decaying click.
 */
function beatBuffer(bpm: number, seconds: number): { sampleRate: number; getChannelData: () => Float32Array } {
    const length = SAMPLE_RATE * seconds;
    const data = new Float32Array(length);
    const samplesPerBeat = Math.round((60 / bpm) * SAMPLE_RATE);
    const clickLen = Math.round(SAMPLE_RATE * 0.02); // 20 ms click
    for (let beat = 0; beat * samplesPerBeat < length; beat++) {
        const start = beat * samplesPerBeat;
        for (let index = 0; index < clickLen && start + index < length; index++) {
            const env = 1 - index / clickLen;
            data[start + index] = Math.sin((2 * Math.PI * 1000 * index) / SAMPLE_RATE) * env;
        }
    }
    return { sampleRate: SAMPLE_RATE, getChannelData: () => data };
}

const silent = silentBuffer();
const beat120 = beatBuffer(120, 5);

// Production imports `audioBufferCache` from `#/modules/AudioEngine/stores`;
// the previous `#/modules/AudioEngine/useCases` mock was inert, so the
// detector read the real empty store and never ran onset detection.
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => {
            if (id === 'silent') {
                return silent;
            }
            if (id === 'beat120') {
                return beat120;
            }
            return null;
        }),
    },
}));

import { detectTempo } from '../tempoDetection';

describe('detectTempo', () => {
    it('returns null when the buffer is missing', () => {
        expect(detectTempo('missing')).toBeNull();
    });

    it('returns null when there are not enough onsets (silent buffer)', () => {
        // The buffer is now actually injected, so onset detection runs over the
        // silent signal, finds < 4 onsets, and returns null.
        expect(detectTempo('silent')).toBeNull();
    });

    it('recovers 120 BPM from evenly spaced beats', () => {
        // Exercises the full onset + interval-histogram pipeline; the detected
        // tempo must land on the synthesized 120 BPM (allowing rounding slack).
        const bpm = detectTempo('beat120');
        expect(bpm).not.toBeNull();
        expect(bpm!).toBeGreaterThanOrEqual(118);
        expect(bpm!).toBeLessThanOrEqual(122);
    });
});
