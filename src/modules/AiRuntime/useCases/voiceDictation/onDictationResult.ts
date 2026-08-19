import {
    onDictationResult as onVoiceDictationResult,
    type DictationResult as NativeDictationResult,
} from '../../repositories/voiceNativeAdapter/onDictationResult';

export type DictationResult = {
    text: string;
    durationMs: number;
};

export function onDictationResult(handler: (result: DictationResult) => void): Promise<() => void> {
    return onVoiceDictationResult((result: NativeDictationResult) => {
        handler({
            text: result.text,
            durationMs: result.duration_ms,
        });
    });
}
