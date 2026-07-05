import { beforeEach, describe, expect, it } from 'vitest';

import { voiceStatusStore } from '../../stores/voiceStatusStore';
import { setVoiceStatus } from '../setVoiceStatus';

describe('setVoiceStatus', () => {
    beforeEach(() => {
        voiceStatusStore.set({ isListening: false, transcribing: false });
    });

    it('should replace the full voice status', () => {
        const status = setVoiceStatus({ isListening: true, transcribing: true });

        expect(status).toEqual({ isListening: true, transcribing: true });
        expect(voiceStatusStore.value).toEqual({ isListening: true, transcribing: true });
    });
});
