import { describe, it, expect, vi } from 'vitest';

const fakeBuffer = {
    sampleRate: 44100,
    getChannelData: vi.fn(() => new Float32Array(8192).fill(0)),
};

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => (id === 'present' ? fakeBuffer : null)),
    },
}));

import { detectKey } from '../keyDetection';

describe('detectKey', () => {
    it('returns null when the audio buffer is missing', () => {
        expect(detectKey('missing')).toBeNull();
    });

    it('returns null on a silent buffer (no chroma energy)', () => {
        // The Goertzel pass over an all-zero buffer yields zero chroma; the
        // function returns null in that case.
        expect(detectKey('present')).toBeNull();
    });
});
