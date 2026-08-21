import { loadCachedWhisperModel as loadCachedNativeWhisperModel } from '../../repositories/voiceNativeAdapter/loadCachedWhisperModel';

export function loadCachedWhisperModel(): Promise<void> {
    return loadCachedNativeWhisperModel();
}
