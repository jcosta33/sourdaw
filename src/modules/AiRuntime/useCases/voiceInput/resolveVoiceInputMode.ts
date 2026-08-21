import { isNativeVoiceInputAvailable } from '../../repositories/voiceInput/isNativeVoiceInputAvailable';

export type VoiceInputMode = 'whisper' | null;

export function resolveVoiceInputMode(): VoiceInputMode {
    if (isNativeVoiceInputAvailable()) {
        return 'whisper';
    }

    return null;
}
