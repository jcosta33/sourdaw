import { voiceStatusStore, type VoiceStatus } from '../stores/voiceStatusStore';

type SetVoiceTranscribingStatusOutput = VoiceStatus;

export function setVoiceTranscribingStatus(transcribing: boolean): SetVoiceTranscribingStatusOutput {
    let next_status: SetVoiceTranscribingStatusOutput = {
        isListening: false,
        transcribing,
    };
    voiceStatusStore.update((status) => {
        next_status = {
            isListening: status?.isListening ?? false,
            transcribing,
        };
        return next_status;
    });
    return next_status;
}
