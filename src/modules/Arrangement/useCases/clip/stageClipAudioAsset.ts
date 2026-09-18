import { clipAudioAssetStagerRef } from './clipAudioAssetStagingState';

/**
 * Stage `buffer`'s bytes for shareable transfer, or return `null` when no
 * stager is registered. A registered stager that fails to stage throws — an
 * insertion that cannot bind the identity it promised must be abandoned by
 * the caller, not published unhashed (#3759).
 */
export async function stageClipAudioAsset(
    buffer: AudioBuffer,
    name: string
): Promise<{ hash: string; leaseId: string } | null> {
    const stager = clipAudioAssetStagerRef.current;
    if (!stager) {
        return null;
    }
    return stager(buffer, name);
}
