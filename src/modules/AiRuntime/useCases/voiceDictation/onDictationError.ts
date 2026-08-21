import { onDictationError as onVoiceDictationError } from '../../repositories/voiceNativeAdapter/onDictationError';

export type DictationError = {
    sessionId: string;
    message: string;
};

export function onDictationError(sessionId: string, handler: (error: DictationError) => void): () => void {
    return onVoiceDictationError(sessionId, (error) =>
        handler({ sessionId: error.session_id, message: error.message })
    );
}
