import { beforeEach, describe, expect, it } from 'vitest';

import { voiceStatusStore } from '../../stores/voiceStatusStore';
import { setVoiceTranscribingStatus } from '../setVoiceTranscribingStatus';

describe('setVoiceTranscribingStatus', () => {
    beforeEach(() => {
        voiceStatusStore.set({ isListening: false, transcribing: false });
    });

    it('should update transcribing while preserving listening', () => {
        voiceStatusStore.set({ isListening: true, transcribing: false });

        const status = setVoiceTranscribingStatus(true);

        expect(status).toEqual({ isListening: true, transcribing: true });
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });
    });

    it('should fall back to a non-listening status when current status is empty', () => {
        voiceStatusStore.set(null);

        const status = setVoiceTranscribingStatus(true);

        expect(status).toEqual({ isListening: false, transcribing: true });
        expect(voiceStatusStore.value).toEqual({ isListening: false, transcribing: true });
    });
});
