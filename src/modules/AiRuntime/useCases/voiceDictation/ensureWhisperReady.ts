import { ensureWhisperReady as ensureWhisperReadyInAdapter } from '../../repositories/voiceTauriAdapter/ensureWhisperReady';

export function ensureWhisperReady(): Promise<void> {
    return ensureWhisperReadyInAdapter();
}