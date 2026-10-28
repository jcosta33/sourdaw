import { getAssetTransfer } from './collaboration/getAssetTransfer';
import { collaborationAssetOwnership } from './collaboration/getCollaborationAssetOwnerId';

/** Suppress peer requests for every original just restored from the local project. */
export async function activateProjectOriginalMedia(
    projectId: string,
    hashes: readonly string[],
    shouldContinue: () => boolean
): Promise<void> {
    if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
        return;
    }
    const transfer = getAssetTransfer();
    if (!transfer) {
        return;
    }
    for (const hash of hashes) {
        if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
            return;
        }
        const opened = await transfer.reopenDurableAsset(hash);
        if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
            return;
        }
        if (opened.status !== 'opened') {
            throw new Error(`Project original could not be activated: ${hash}`);
        }
    }
}
