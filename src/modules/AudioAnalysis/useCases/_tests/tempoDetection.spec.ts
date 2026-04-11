import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/AudioEngine', () => ({
    audioBufferCache: {
        get: vi.fn((id: string) => {
            if (id === 'silent') {
                return { sampleRate: 44100, getChannelData: () => new Float32Array(44100).fill(0) };
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
        expect(detectTempo('silent')).toBeNull();
    });
});
