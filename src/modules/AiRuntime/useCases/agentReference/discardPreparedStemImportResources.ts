import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetLeaseId?: string;
};

export function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): void {
    const transfer = getAssetTransfer();
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
        if (stem.assetLeaseId) {
            transfer?.releaseStagedAsset(stem.assetLeaseId);
        }
    }
}
