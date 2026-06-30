import { isBrowserSpeechRecognitionAvailable } from '../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable';
import { isNativeVoiceInputAvailable } from '../../repositories/voiceInput/isNativeVoiceInputAvailable';

export type VoiceInputMode = 'browser' | 'whisper' | null;

type ResolveVoiceInputModeInput = {
    browserMode: 'allowed' | 'disabled';
};

export function resolveVoiceInputMode(input: ResolveVoiceInputModeInput = { browserMode: 'allowed' }): VoiceInputMode {
    if (input.browserMode === 'allowed' && isBrowserSpeechRecognitionAvailable()) {
        return 'browser';
    }

    if (isNativeVoiceInputAvailable()) {
        return 'whisper';
    }

    return null;
}
