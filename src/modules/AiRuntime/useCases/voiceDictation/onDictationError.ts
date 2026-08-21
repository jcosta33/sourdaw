import { onDictationError as onVoiceDictationError } from '../../repositories/voiceNativeAdapter/onDictationError';

export type DictationError = {
    sessionId: string;
    message: string;
};

export function onDictationError(handler: (error: DictationError) => void): Promise<() => void> {
    return onVoiceDictationError((error) => handler({ sessionId: error.session_id, message: error.message }));
}
