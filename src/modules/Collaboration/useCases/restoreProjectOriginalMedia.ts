import { createDurableAssetIndexedDb } from '../repositories/durableAssetIndexedDb';
import { createDurableAssetRepository } from '../repositories/durableAssetRepository';

const { hashBlob } = createDurableAssetIndexedDb();

/** Restore verified original bytes under their project identity before the project is made visible. */
export async function restoreProjectOriginalMedia(
    projectId: string,
    media: ReadonlyMap<string, Uint8Array>,
    shouldContinue: () => boolean
): Promise<void> {
    // A later corrupt entry must not add earlier originals to an already open project owner.
    for (const [hash, bytes] of media) {
        if (!shouldContinue()) {
            throw new Error('Project replacement superseded original media restoration');
        }
        const actualHash = await hashBlob(new Blob([Uint8Array.from(bytes)]));
        if (!shouldContinue()) {
            throw new Error('Project replacement superseded original media restoration');
        }
        if (actualHash !== hash) {
            throw new Error(`Project directory original hash mismatch: ${hash}`);
        }
    }
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
        let stagedHash: string | undefined;
        try {
            const result = await repository.stageAsset(leaseId, blob, hash);
            stagedHash = result.hash;
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
            stagedHash = undefined;
            if (!shouldContinue()) {
                throw new Error('Project replacement superseded original media promotion');
            }
        } catch (error) {
            if (stagedHash) {
                const released = await repository.releaseStagedAsset(leaseId, stagedHash);
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
