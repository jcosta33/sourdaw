import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetHash?: string;
    assetLeaseId?: string;
};

export async function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): Promise<void> {
    const transfer = getAssetTransfer();
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
        if (!stem.assetLeaseId && !stem.assetHash) {
            continue;
        }
        if (!stem.assetLeaseId || !stem.assetHash) {
            throw new Error('Prepared stem durable asset binding is incomplete');
        }
        if (!transfer) {
            throw new Error(`Asset transfer is unavailable for staged lease: ${stem.assetLeaseId}`);
        }
        const released = await transfer.releaseDurableStagedAsset(stem.assetLeaseId, stem.assetHash);
        if (released.status === 'failed') {
            throw new Error(`Could not release prepared stem asset ${stem.assetLeaseId}: ${released.reason}`);
        }
    }
}
