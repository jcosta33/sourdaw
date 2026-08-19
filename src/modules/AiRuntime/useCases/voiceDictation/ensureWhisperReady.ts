import { ensureWhisperReady as ensureWhisperReadyInAdapter } from '../../repositories/voiceNativeAdapter/ensureWhisperReady';

export function ensureWhisperReady(): Promise<void> {
    return ensureWhisperReadyInAdapter();
}
