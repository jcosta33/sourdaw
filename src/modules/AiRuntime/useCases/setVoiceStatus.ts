import { voiceStatusStore, type VoiceStatus } from '../stores/voiceStatusStore';

type SetVoiceStatusInput = VoiceStatus;

export function setVoiceStatus(input: SetVoiceStatusInput): void {
    voiceStatusStore.set(input);
}
