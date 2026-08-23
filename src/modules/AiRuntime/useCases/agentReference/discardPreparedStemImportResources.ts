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

function getPrimaryFailureMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Prepared stem import failed';
}

async function discardPreparedStemImportResources(
    stems: readonly PreparedStemResource[],
    promotionRecoveryId?: string
): Promise<void> {
    const cleanup = await prepareDiscardPreparedStemImportResources(stems, promotionRecoveryId);
    if (!cleanup) {
        return;
    }
    const completed = await cleanup.assetTransfer.completeDurableCleanupRecovery(cleanup.recoveryId);
    if (completed.status === 'failed') {
        throw new Error(`Prepared stem resource cleanup remains pending: ${completed.reason}`);
    }
}

async function prepareDiscardPreparedStemImportResources(
    stems: readonly PreparedStemResource[],
    promotionRecoveryId?: string
) {
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
        return null;
    }
    const assetTransfer = getAssetTransfer();
    if (!assetTransfer) {
        throw new Error(`Asset transfer is unavailable for staged lease cleanup: ${bindings[0]?.leaseId}`);
    }
    const recoveryId = promotionRecoveryId ?? getCleanupRecoveryId(bindings);
    const prepared = promotionRecoveryId
        ? await assetTransfer.transitionDurablePromotionRecoveryToCleanup(recoveryId, bindings)
        : await assetTransfer.prepareDurableCleanupRecovery(recoveryId, bindings);
    if (prepared.status === 'failed') {
        throw new Error(`Could not preserve prepared stem cleanup: ${prepared.reason}`);
    }
    return { assetTransfer, recoveryId };
}

/** Preserve the primary operation outcome after durable cleanup ownership is recorded. */
async function discardPreparedStemImportResourcesBestEffort(
    stems: readonly PreparedStemResource[],
    promotionRecoveryId?: string,
    primaryError?: unknown
): Promise<void> {
    let cleanup: Awaited<ReturnType<typeof prepareDiscardPreparedStemImportResources>>;
    try {
        cleanup = await prepareDiscardPreparedStemImportResources(stems, promotionRecoveryId);
    } catch (cleanupError) {
        if (primaryError !== undefined) {
            throw new AggregateError([primaryError, cleanupError], getPrimaryFailureMessage(primaryError), {
                cause: cleanupError,
            });
        }
        throw cleanupError;
    }
    if (!cleanup) {
        return;
    }
    try {
        const completed = await cleanup.assetTransfer.completeDurableCleanupRecovery(cleanup.recoveryId);
        if (completed.status === 'failed') {
            throw new Error(`Prepared stem resource cleanup remains pending: ${completed.reason}`);
        }
    } catch (error) {
        logger.error(new Error('Prepared stem resource cleanup remains retryable', { cause: error }));
    }
}

export const preparedStemImportCleanup = {
    discard: discardPreparedStemImportResources,
    discardBestEffort: discardPreparedStemImportResourcesBestEffort,
} as const;
