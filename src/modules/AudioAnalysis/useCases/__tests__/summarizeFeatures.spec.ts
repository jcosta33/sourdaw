import { beforeEach, describe, it, expect, vi } from 'vitest';

const SAMPLE_RATE = 44100;

/** A pure 440 Hz tone — real Meyda DSP runs against this in the happy paths. */
function toneBuffer(sampleRate: number): { sampleRate: number; getChannelData: () => Float32Array } {
    const length = sampleRate; // 1 second
    const data = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        data[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    }
    return { sampleRate, getChannelData: () => data };
}

const tone44k = toneBuffer(SAMPLE_RATE);

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => {
        if (bufferId === 'tone44k') {
            return tone44k;
        }
        return null;
    }),
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { extractFeatures } from '../audioFeatures';
import { summarizeFeatures } from '../summarizeFeatures';

describe('summarizeFeatures', () => {
    beforeEach(() => {
        vi.mocked(getCachedAudioBuffer).mockClear();
    });

    it('returns null when the buffer is missing', () => {
        expect(summarizeFeatures('missing')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('averages each chroma bin by summing then dividing once', () => {
        // The average must equal a reference that sums raw per-frame chroma and
        // divides by frame count once, avoiding accumulated floating-point drift.
        const frames = extractFeatures('tone44k');
        expect(frames.length).toBeGreaterThan(1);

        const node = frames.length;
        const reference = Array.from({ length: 12 }, (_unused, bin) => {
            let sum = 0;
            for (const frame of frames) {
                sum += frame.chroma[bin] ?? 0;
            }
            return sum / node;
        });

        const summary = summarizeFeatures('tone44k');
        expect(summary).not.toBeNull();
        expect(summary?.chromaProfile).toEqual(reference);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'tone44k' });
    });
});
