import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetLeaseId?: string;
    assetHash?: string;
};

export async function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): Promise<void> {
    const transfer = getAssetTransfer();
    const releases: Promise<void>[] = [];
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
        if (stem.assetLeaseId) {
            if (!stem.assetHash) {
                throw new Error(`Prepared stem has no hash for staged lease: ${stem.assetLeaseId}`);
            }
            if (!transfer) {
                throw new Error(`Asset transfer is unavailable for staged lease: ${stem.assetLeaseId}`);
            }
            releases.push(
                transfer.releaseStagedAsset(stem.assetLeaseId, stem.assetHash).then((result) => {
                    if (result.status === 'failed') {
                        throw new Error(`Could not release staged lease ${stem.assetLeaseId}: ${result.reason}`);
                    }
                })
            );
        }
    }
    await Promise.all(releases);
}
