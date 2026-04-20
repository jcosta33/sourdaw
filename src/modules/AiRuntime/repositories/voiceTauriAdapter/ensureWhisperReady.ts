import { tauriInvoke } from '#/utils/tauriBridge';

/**
 * Ensure the Whisper model is downloaded and loaded before first use.
 * Auto-downloads ~142MB model from HuggingFace on first call.
 */
export async function ensureWhisperReady(): Promise<void> {
    await tauriInvoke('ensure_whisper_ready');
}
