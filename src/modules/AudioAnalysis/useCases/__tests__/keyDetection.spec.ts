import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => {
        if (bufferId === 'silent') {
            return silentBuffer;
        }
        if (bufferId === 'tonalA') {
            return tonalBuffer;
        }
        return null;
    }),
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { detectKey } from '../keyDetection';

describe('detectKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when the audio buffer is missing', () => {
        expect(detectKey('missing')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('returns null on a silent buffer because the Goertzel pass finds no chroma energy', () => {
        // With the buffer actually injected, the Goertzel pass runs over the
        // all-zero signal and produces zero chroma, so the function returns
        // null — proving the DSP executed (not an early store miss).
        expect(detectKey('silent')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'silent' });
    });

    it('detects pitch class A from a 220 Hz (A3) tone', () => {
        // Exercises the real Goertzel + Krumhansl-Schmuckler happy path: a
        // tonal signal must yield a non-null key whose root is A.
        const result = detectKey('tonalA');
        expect(result).not.toBeNull();
        expect(result?.key).toBe('A');
        expect(result?.confidence).toBeGreaterThan(0);
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'tonalA' });
    });
});
