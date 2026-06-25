import Meyda from 'meyda';
import { describe, it, expect, vi } from 'vitest';

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

// Production imports `audioBufferCache` from `#/modules/AudioEngine/stores`;
// the previous `#/modules/AudioEngine/useCases` mock was inert, so extraction
// read the real empty store and never ran Meyda. `meyda` itself is left
// unmocked so the feature math runs for real.
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => {
            if (id === 'tone44k') {
                return tone44k;
            }
            if (id === 'tone48k') {
                return tone48k;
            }
            return null;
        }),
    },
}));

import { extractFeatures, summarizeFeatures } from '../audioFeatures';

describe('audioFeatures', () => {
    it('extractFeatures returns an empty array when the buffer is missing', () => {
        expect(extractFeatures('missing')).toEqual([]);
    });

    it('summarizeFeatures returns null when the buffer is missing', () => {
        expect(summarizeFeatures('missing')).toBeNull();
    });

    it('extractFeatures produces frames for a real tone', () => {
        // With the buffer actually injected and Meyda real, extraction yields
        // one feature snapshot per analysis window.
        const frames = extractFeatures('tone44k');
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0]?.chroma.length).toBe(12);
    });

    it('summarizeFeatures averages each chroma bin by summing then dividing once', () => {
        // Fix 2: the average must equal a reference that sums the raw per-frame
        // chroma and divides by the frame count exactly once. The previous code
        // divided inside the accumulation loop, compounding floating-point
        // rounding so at least one bin drifted by an ULP from this reference.
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
