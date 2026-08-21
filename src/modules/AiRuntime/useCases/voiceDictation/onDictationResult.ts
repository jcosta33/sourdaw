import {
    onDictationResult as onVoiceDictationResult,
    type DictationResult as NativeDictationResult,
} from '../../repositories/voiceNativeAdapter/onDictationResult';

export type DictationResult = {
    sessionId: string;
    text: string;
    durationMs: number;
};

export function onDictationResult(sessionId: string, handler: (result: DictationResult) => void): () => void {
    return onVoiceDictationResult(sessionId, (result: NativeDictationResult) => {
        handler({
            sessionId: result.session_id,
            text: result.text,
            durationMs: result.duration_ms,
        });
    });
}
