import { describe, it, expect, beforeEach } from 'vitest';

import { voiceStatusStore } from '../voiceStatusStore';

describe('voiceStatusStore', () => {
    beforeEach(() => {
        voiceStatusStore.set({ isListening: false, transcribing: false });
    });

    it('initializes with default values', () => {
        expect(voiceStatusStore.value).toEqual({
            isListening: false,
            transcribing: false,
        });
    });

    it('can be updated', () => {
        voiceStatusStore.set({ isListening: true, transcribing: false });
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: false });

        voiceStatusStore.set({ isListening: false, transcribing: true });
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: true });
    });
});
