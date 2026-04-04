import {
    ensureWhisperReady,
    startDictation,
    stopDictation,
    onDictationResult,
    type DictationResult,
} from '../repositories/voiceTauriAdapter';

export type { DictationResult };
export { ensureWhisperReady, startDictation, stopDictation, onDictationResult };
