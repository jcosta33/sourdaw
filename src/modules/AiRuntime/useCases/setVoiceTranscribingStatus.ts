import { voiceStatusStore } from '../stores/voiceStatusStore';

export function setVoiceTranscribingStatus(transcribing: boolean): void {
    voiceStatusStore.update((status) => {
        return {
            isListening: status?.isListening ?? false,
            transcribing,
        };
    });
}
