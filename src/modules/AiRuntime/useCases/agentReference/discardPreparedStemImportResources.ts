import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetHash?: string;
    stagedAssetOwned?: boolean;
};

export function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): void {
    const transfer = getAssetTransfer();
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
        if (stem.assetHash && stem.stagedAssetOwned === true) {
            transfer?.removeLocalAsset(stem.assetHash);
        }
    }
}
