import {
    ensureWhisperReady as ensureWhisperReadyInAdapter,
    startDictation as startVoiceDictation,
    stopDictation as stopVoiceDictation,
    onDictationResult as onVoiceDictationResult,
} from '../repositories/voiceTauriAdapter';

export type DictationResult = {
    text: string;
    durationMs: number;
};

export function ensureWhisperReady(): Promise<void> {
    return ensureWhisperReadyInAdapter();
}

export function startDictation(): Promise<void> {
    return startVoiceDictation();
}

export function stopDictation(): Promise<void> {
    return stopVoiceDictation();
}

export function onDictationResult(handler: (result: DictationResult) => void): Promise<() => void> {
    return onVoiceDictationResult((result) => {
        handler({
            text: result.text,
            durationMs: result.duration_ms,
        });
    });
}
