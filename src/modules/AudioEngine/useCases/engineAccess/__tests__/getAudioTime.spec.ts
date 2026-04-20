import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { getAudioTime } from '../getAudioTime';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 1.5 } as BaseAudioContext,
    },
}));

describe('getAudioTime', () => {
    beforeEach(() => {
        vi.mocked(audioEngine).context = { currentTime: 1.5 } as BaseAudioContext;
    });

    it('should return the audio context currentTime when available', () => {
        expect(getAudioTime()).toBe(1.5);
    });

    it('should return zero when context is missing', () => {
        (audioEngine as any).context = null;
        expect(getAudioTime()).toBe(0);
    });
});
