import { voiceStatusStore, type VoiceStatus } from '../stores/voiceStatusStore';

type SetVoiceListeningStatusOutput = VoiceStatus;

export function setVoiceListeningStatus(isListening: boolean): SetVoiceListeningStatusOutput {
    let next_status: SetVoiceListeningStatusOutput = {
        isListening,
        transcribing: false,
    };
    voiceStatusStore.update((status) => {
        next_status = {
            isListening,
            transcribing: status?.transcribing ?? false,
        };
        return next_status;
    });
    return next_status;
}
