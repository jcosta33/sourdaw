import { desktopInvoke } from '#/utils/desktopBridge';

/** Begin native audio capture + Whisper inference session. */
export async function startDictation(): Promise<void> {
    await desktopInvoke('start_dictation');
}
