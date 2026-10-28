import { getAssetTransfer } from './collaboration/getAssetTransfer';
import { collaborationAssetOwnership } from './collaboration/getCollaborationAssetOwnerId';

type CapturedOriginals = {
    media: Map<string, Blob>;
    unavailable: string[];
};

/** Resolve only verified project-owned originals; an old clip hash alone proves no ownership. */
export async function captureProjectOriginalMedia(
    projectId: string,
    hashes: readonly string[],
    shouldContinue: () => boolean
): Promise<CapturedOriginals> {
    if (collaborationAssetOwnership.getOwnerId() !== projectId) {
        throw new Error('Project original media owner changed');
    }
    const transfer = getAssetTransfer();
    if (!transfer) {
        throw new Error('Project original media runtime is unavailable');
    }
    const media = new Map<string, Blob>();
    const unavailable: string[] = [];
    for (const hash of new Set(hashes)) {
        if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
            throw new Error('Project changed while original media was collected');
        }
        let opened = await transfer.reopenDurableAsset(hash);
        if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
            throw new Error('Project changed while original media was reopened');
        }
        if (
            opened.status === 'failed' &&
            (opened.reason === 'asset-not-owned' || opened.reason === 'missing-asset') &&
            (await transfer.retainLocalOriginal(hash))
        ) {
            if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
                throw new Error('Project changed while resident original media was retained');
            }
            opened = await transfer.reopenDurableAsset(hash);
        }
        if (!shouldContinue() || collaborationAssetOwnership.getOwnerId() !== projectId) {
            throw new Error('Project changed while original media was collected');
        }
        if (opened.status === 'opened') {
            media.set(hash, opened.blob);
        } else if (opened.reason === 'asset-not-owned' || opened.reason === 'missing-asset') {
            unavailable.push(hash);
        } else {
            throw new Error(`Project original media failed integrity verification: ${hash}: ${opened.reason}`);
        }
    }
    return { media, unavailable };
}
