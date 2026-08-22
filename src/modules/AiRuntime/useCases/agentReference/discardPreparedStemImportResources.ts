import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetLeaseId?: string;
    assetHash?: string;
};

export async function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): Promise<void> {
    const transfer = getAssetTransfer();
    const bindings: Array<{ leaseId: string; expectedHash: string }> = [];
    for (const stem of stems) {
        if (stem.assetLeaseId) {
            if (!stem.assetHash) {
                throw new Error(`Prepared stem has no hash for staged lease: ${stem.assetLeaseId}`);
            }
            if (!transfer) {
                throw new Error(`Asset transfer is unavailable for staged lease: ${stem.assetLeaseId}`);
            }
            bindings.push({ leaseId: stem.assetLeaseId, expectedHash: stem.assetHash });
        }
    }
    if (bindings.length > 0) {
        const result = await transfer?.releaseStagedAssets(bindings);
        if (!result || result.status === 'failed') {
            throw new Error(`Could not release staged stem assets: ${result?.reason ?? 'asset-transfer-unavailable'}`);
        }
    }
    // PCM remains executable until the durable lease set has settled in one
    // transaction. A failed release therefore leaves the confirmation wholly
    // retryable instead of partially destroying its inputs.
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
    }
}
