import { desktopInvoke } from '#/utils/desktopBridge';

/** Load only a hash-verified Whisper artifact already present in the local cache. */
export async function loadCachedWhisperModel(): Promise<void> {
    await desktopInvoke('load_cached_whisper_model');
}
