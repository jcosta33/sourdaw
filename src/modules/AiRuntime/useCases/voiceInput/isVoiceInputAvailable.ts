import { isBrowserSpeechRecognitionAvailable } from '../../repositories/voiceInput/isBrowserSpeechRecognitionAvailable';
import { isNativeVoiceInputAvailable } from '../../repositories/voiceInput/isNativeVoiceInputAvailable';

export function isVoiceInputAvailable(): boolean {
    if (isBrowserSpeechRecognitionAvailable()) {
        return true;
    }

    return isNativeVoiceInputAvailable();
}
