import { beforeEach, describe, expect, it } from 'vitest';

import { voiceStatusStore } from '../../stores/voiceStatusStore';
import { setVoiceListeningStatus } from '../setVoiceListeningStatus';

describe('setVoiceListeningStatus', () => {
    beforeEach(() => {
        voiceStatusStore.set({ isListening: false, transcribing: false });
    });

    it('should update listening while preserving transcribing', () => {
        voiceStatusStore.set({ isListening: false, transcribing: true });

        const status = setVoiceListeningStatus(true);

        expect(status).toEqual({ isListening: true, transcribing: true });
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });
    });

    it('should fall back to a non-transcribing status when current status is empty', () => {
        voiceStatusStore.set(null);

        const status = setVoiceListeningStatus(true);

        expect(status).toEqual({ isListening: true, transcribing: false });
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: false });
    });
});
