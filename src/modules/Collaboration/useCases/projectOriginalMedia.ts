import { createDurableAssetRepository } from '../repositories/durableAssetRepository';

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

/** Restore verified folder bytes under their project identity before the project is made visible. */
export async function restoreProjectOriginalMedia(
    projectId: string,
    media: ReadonlyMap<string, Uint8Array>,
    shouldContinue: () => boolean
): Promise<void> {
    const repository = createDurableAssetRepository(projectId);
    for (const [hash, bytes] of media) {
        if (!shouldContinue()) {
            throw new Error('Project replacement superseded original media restoration');
        }
        const existing = await repository.reopenDurableAsset(hash);
        if (!shouldContinue()) {
            throw new Error('Project replacement superseded original media restoration');
        }
        if (existing.status === 'opened') {
            continue;
        }
        if (existing.reason !== 'asset-not-owned' && existing.reason !== 'missing-asset') {
            throw new Error(`Project original media could not be reopened: ${hash}: ${existing.reason}`);
        }
        const leaseId = `directory-original-${crypto.randomUUID()}`;
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const blob = new Blob([copy]);
        let staged = false;
        try {
            const result = await repository.stageAsset(leaseId, blob, hash);
            staged = true;
            if (!shouldContinue()) {
                throw new Error('Project replacement superseded original media staging');
            }
            if (result.hash !== hash) {
                throw new Error(`Project directory original hash mismatch: ${hash}`);
            }
            const promoted = await repository.promoteStagedAsset(leaseId, hash);
            if (promoted.status === 'failed') {
                throw new Error(`Project directory original could not be retained: ${hash}: ${promoted.reason}`);
            }
            staged = false;
            if (!shouldContinue()) {
                throw new Error('Project replacement superseded original media promotion');
            }
        } catch (error) {
            if (staged) {
                const released = await repository.releaseStagedAsset(leaseId, hash);
                if (released.status === 'failed') {
                    throw new Error(`Project directory original staging could not be released: ${hash}`, {
                        cause: error,
                    });
                }
            }
            throw error;
        }
    }
}

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
