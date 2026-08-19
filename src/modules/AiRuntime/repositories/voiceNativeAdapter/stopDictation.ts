import { desktopInvoke } from '#/utils/desktopBridge';

/** Stop capture and trigger Whisper transcription. */
export async function stopDictation(): Promise<void> {
    await desktopInvoke('stop_dictation');
}
