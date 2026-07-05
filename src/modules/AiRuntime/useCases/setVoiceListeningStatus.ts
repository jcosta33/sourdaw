import { voiceStatusStore } from '../stores/voiceStatusStore';

export function setVoiceListeningStatus(isListening: boolean): void {
    voiceStatusStore.update((status) => {
        return {
            isListening,
            transcribing: status?.transcribing ?? false,
        };
    });
}
