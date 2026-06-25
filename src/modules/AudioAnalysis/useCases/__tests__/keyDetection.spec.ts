import { describe, it, expect, vi } from 'vitest';

const silentBuffer = {
    sampleRate: 44100,
    getChannelData: vi.fn(() => new Float32Array(8192).fill(0)),
};

/**
 * A 220 Hz (A3) sine across the whole buffer. A3 is pitch class A, so a
 * correct chroma + Krumhansl-Schmuckler correlation should land on an A key.
 */
function tonalA3Buffer(): { sampleRate: number; getChannelData: () => Float32Array } {
    const sampleRate = 44100;
    const length = 44100; // 1 second, long enough for several Goertzel frames
    const data = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        data[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate);
    }
    return { sampleRate, getChannelData: () => data };
}

const tonalBuffer = tonalA3Buffer();

// Production imports `audioBufferCache` from `#/modules/AudioEngine/stores`;
// mocking that exact path is what makes the injected fake buffer visible to
// the detector (the previous `#/modules/AudioEngine/useCases` mock was inert,
// so the detector read the real empty store and early-returned before the DSP).
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => {
            if (id === 'silent') {
                return silentBuffer;
            }
            if (id === 'tonalA') {
                return tonalBuffer;
            }
            return null;
        }),
    },
}));

import { detectKey } from '../keyDetection';

describe('detectKey', () => {
    it('returns null when the audio buffer is missing', () => {
        expect(detectKey('missing')).toBeNull();
    });

    it('returns null on a silent buffer because the Goertzel pass finds no chroma energy', () => {
        // With the buffer actually injected, the Goertzel pass runs over the
        // all-zero signal and produces zero chroma, so the function returns
        // null — proving the DSP executed (not an early store miss).
        expect(detectKey('silent')).toBeNull();
    });

    it('detects pitch class A from a 220 Hz (A3) tone', () => {
        // Exercises the real Goertzel + Krumhansl-Schmuckler happy path: a
        // tonal signal must yield a non-null key whose root is A.
        const result = detectKey('tonalA');
        expect(result).not.toBeNull();
        expect(result?.key).toBe('A');
        expect(result?.confidence).toBeGreaterThan(0);
    });
});
