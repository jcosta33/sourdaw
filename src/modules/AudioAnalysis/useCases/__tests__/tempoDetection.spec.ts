import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => {
        if (bufferId === 'silent') {
            return silent;
        }
        if (bufferId === 'beat120') {
            return beat120;
        }
        return null;
    }),
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { detectTempo } from '../tempoDetection';

describe('detectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when the buffer is missing', () => {
        expect(detectTempo('missing')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('returns null when there are not enough onsets (silent buffer)', () => {
        // The buffer is now actually injected, so onset detection runs over the
        // silent signal, finds < 4 onsets, and returns null.
        expect(detectTempo('silent')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'silent' });
    });

    it('recovers 120 BPM from evenly spaced beats', () => {
        // Exercises the full onset + interval-histogram pipeline; the detected
        // tempo must land on the synthesized 120 BPM (allowing rounding slack).
        const bpm = detectTempo('beat120');
        expect(bpm).not.toBeNull();
        expect(bpm!).toBeGreaterThanOrEqual(118);
        expect(bpm!).toBeLessThanOrEqual(122);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'beat120' });
    });
});
