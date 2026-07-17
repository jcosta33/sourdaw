import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioTime } from '../getAudioTime';

const engine_context = vi.hoisted(() => ({ value: null as BaseAudioContext | null }));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        get context() {
            return engine_context.value;
        },
    },
}));

describe('getAudioTime', () => {
    beforeEach(() => {
        engine_context.value = { currentTime: 1.5 } as BaseAudioContext;
    });

    it('should return the audio context currentTime when available', () => {
        expect(getAudioTime()).toBe(1.5);
    });

    it('should return zero when context is missing', () => {
        engine_context.value = null;
        expect(getAudioTime()).toBe(0);
    });
});
