import { logger } from '#/infra/logger/appLogger';
import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetHash?: string;
    assetLeaseId?: string;
};

function getCleanupRecoveryId(bindings: readonly { leaseId: string }[]): string {
    return `stem-cleanup:${JSON.stringify(bindings.map((binding) => binding.leaseId).toSorted())}`;
}

async function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): Promise<void> {
    for (const stem of stems) {
        releasePreviewAudioBuffer(stem.audioBufferId);
    }
    const bindings = stems.flatMap((stem) => {
        if (!stem.assetLeaseId && !stem.assetHash) {
            return [];
        }
        if (!stem.assetLeaseId || !stem.assetHash) {
            throw new Error('Prepared stem durable asset binding is incomplete');
        }
        return [{ leaseId: stem.assetLeaseId, expectedHash: stem.assetHash }];
    });
    if (bindings.length === 0) {
        return;
    }
    const assetTransfer = getAssetTransfer();
    if (!assetTransfer) {
        throw new Error(`Asset transfer is unavailable for staged lease cleanup: ${bindings[0]?.leaseId}`);
    }
    const recoveryId = getCleanupRecoveryId(bindings);
    const prepared = await assetTransfer.prepareDurableCleanupRecovery(recoveryId, bindings);
    if (prepared.status === 'failed') {
        throw new Error(`Could not preserve prepared stem cleanup: ${prepared.reason}`);
    }
    const completed = await assetTransfer.completeDurableCleanupRecovery(recoveryId);
    if (completed.status === 'failed') {
        throw new Error(`Prepared stem resource cleanup remains pending: ${completed.reason}`);
    }
}

/** Preserve the primary operation outcome after durable cleanup ownership is recorded. */
async function discardPreparedStemImportResourcesBestEffort(stems: readonly PreparedStemResource[]): Promise<void> {
    try {
        await discardPreparedStemImportResources(stems);
    } catch (error) {
        logger.error(new Error('Prepared stem resource cleanup remains retryable', { cause: error }));
    }
}

export const preparedStemImportCleanup = {
    discard: discardPreparedStemImportResources,
    discardBestEffort: discardPreparedStemImportResourcesBestEffort,
} as const;
