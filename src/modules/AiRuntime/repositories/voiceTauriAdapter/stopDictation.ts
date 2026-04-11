import { tauriInvoke } from '#/helpers/tauriBridge';

/** Stop capture and trigger Whisper transcription. */
export async function stopDictation(): Promise<void> {
    await tauriInvoke('stop_dictation');
}