/**
 * voiceStatusStore — lightweight store so VoiceButton can reflect
 * the active listening state that lives inside useVoiceRecording.
 */
import { createStore } from '#/infra/store/createStore';

export type VoiceStatus = {
    isListening: boolean;
    transcribing: boolean;
};

export const voiceStatusStore = createStore<VoiceStatus>({
    initialData: { isListening: false, transcribing: false },
});
