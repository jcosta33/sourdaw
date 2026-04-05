/**
 * voiceTauriAdapter — Native voice dictation IPC boundary.
 *
 * All bare-metal Tauri IPC for Whisper/dictation must live here, not in
 * presentation hooks. Presentation layer imports functions from this file.
 */

import { tauriInvoke, tauriListen } from '#/helpers/tauriBridge';

export type DictationResult = {
    text: string;
    duration_ms: number;
};

/**
 * Ensure the Whisper model is downloaded and loaded before first use.
 * Auto-downloads ~142MB model from HuggingFace on first call.
 */
export async function ensureWhisperReady(): Promise<void> {
    await tauriInvoke('ensure_whisper_ready');
}

/** Begin native audio capture + Whisper inference session. */
export async function startDictation(): Promise<void> {
    await tauriInvoke('start_dictation');
}

/** Stop capture and trigger Whisper transcription. */
export async function stopDictation(): Promise<void> {
    await tauriInvoke('stop_dictation');
}

/**
 * Subscribe to the dictation-result event emitted by Rust after transcription.
 * Returns an unlisten function to clean up the listener.
 */
export async function onDictationResult(handler: (result: DictationResult) => void): Promise<() => void> {
    const unlisten = await tauriListen('dictation-result', (payload: unknown) => {
        const event = payload as { payload: DictationResult };
        handler(event.payload);
    });
    return unlisten;
}
