import { tauriInvoke } from '#/utils/tauriBridge';

/** Stop capture and trigger Whisper transcription. */
export async function stopDictation(): Promise<void> {
    await tauriInvoke('stop_dictation');
}