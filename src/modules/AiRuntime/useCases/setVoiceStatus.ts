import { voiceStatusStore, type VoiceStatus } from '../stores/voiceStatusStore';

type SetVoiceStatusInput = VoiceStatus;
type SetVoiceStatusOutput = VoiceStatus;

export function setVoiceStatus(input: SetVoiceStatusInput): SetVoiceStatusOutput {
    voiceStatusStore.set(input);
    return input;
}
