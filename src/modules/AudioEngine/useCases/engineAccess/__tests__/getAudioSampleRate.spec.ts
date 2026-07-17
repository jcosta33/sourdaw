import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioSampleRate } from '../getAudioSampleRate';

const engine_context = vi.hoisted(() => ({ value: null as AudioContext | null }));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        get context() {
            return engine_context.value;
        },
    },
}));

describe('getAudioSampleRate', () => {
    beforeEach(() => {
        engine_context.value = { sampleRate: 48_000 } as AudioContext;
    });

    it('should return the context sample rate when available', () => {
        expect(getAudioSampleRate()).toBe(48_000);
    });

    it('should fall back to 44100 when context is missing', () => {
        engine_context.value = null;
        expect(getAudioSampleRate()).toBe(44_100);
    });
});
