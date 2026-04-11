import { tauriInvoke } from '#/helpers/tauriBridge';

/** Begin native audio capture + Whisper inference session. */
export async function startDictation(): Promise<void> {
    await tauriInvoke('start_dictation');
}