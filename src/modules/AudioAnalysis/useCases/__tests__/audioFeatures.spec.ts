import Meyda from 'meyda';
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
const tone48k = toneBuffer(48000);

// Mock the AudioEngine-owned cache-read boundary while leaving Meyda real.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => {
        if (bufferId === 'tone44k') {
            return tone44k;
        }
        if (bufferId === 'tone48k') {
            return tone48k;
        }
        return null;
    }),
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { extractFeatures } from '../audioFeatures';

describe('audioFeatures', () => {
    beforeEach(() => {
        vi.mocked(getCachedAudioBuffer).mockClear();
    });

    it('extractFeatures returns an empty array when the buffer is missing', () => {
        expect(extractFeatures('missing')).toEqual([]);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('extractFeatures produces frames for a real tone', () => {
        const frames = extractFeatures('tone44k');
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0]?.chroma.length).toBe(12);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'tone44k' });
    });

    it('restores Meyda global config after extraction (reentrancy)', () => {
        // Fix 3: extractFeatures writes Meyda.sampleRate/bufferSize to run, but
        // must leave the module singleton exactly as it found it so a later
        // caller is not silently reconfigured to this call's sample rate.
        const sentinelSampleRate = 12345;
        const sentinelBufferSize = 256;
        Meyda.sampleRate = sentinelSampleRate;
        Meyda.bufferSize = sentinelBufferSize;

        const frames = extractFeatures('tone48k', { bufferSize: 1024 });
        expect(frames.length).toBeGreaterThan(0);

        expect(Meyda.sampleRate).toBe(sentinelSampleRate);
        expect(Meyda.bufferSize).toBe(sentinelBufferSize);
    });

    it('accepts a non-power-of-two bufferSize by rounding it up', () => {
        // Fix 4: Meyda.extract throws ("Buffer size must be a power of 2") when
        // the window length is not a power of two. A bufferSize of 1500 must be
        // rounded up (to 2048) so extraction still yields frames instead of
        // throwing.
        expect(() => extractFeatures('tone44k', { bufferSize: 1500 })).not.toThrow();
        const frames = extractFeatures('tone44k', { bufferSize: 1500 });
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0]?.chroma.length).toBe(12);
    });
});
