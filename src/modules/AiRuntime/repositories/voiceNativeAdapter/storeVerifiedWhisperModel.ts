import { desktopInvoke } from '#/utils/desktopBridge';

/**
 * Persist renderer-downloaded, pre-verified Whisper bytes through the native
 * verified writer. The native boundary re-verifies size and SHA-256 before
 * anything reaches the cache, so a refusal here is a rejection, never a
 * partial install.
 */
export async function storeVerifiedWhisperModel(bytes: Uint8Array): Promise<void> {
    await desktopInvoke('store_verified_whisper_model', { bytes });
}
