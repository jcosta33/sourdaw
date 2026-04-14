import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { getAudioSampleRate } from '../getAudioSampleRate';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { sampleRate: 48_000 } as AudioContext,
    },
}));

describe('getAudioSampleRate', () => {
    beforeEach(() => {
        vi.mocked(audioEngine).context = { sampleRate: 48_000 } as AudioContext;
    });

    it('should return the context sample rate when available', () => {
        expect(getAudioSampleRate()).toBe(48_000);
    });

    it('should fall back to 44100 when context is missing', () => {
        (audioEngine as any).context = null;
        expect(getAudioSampleRate()).toBe(44_100);
    });
});
