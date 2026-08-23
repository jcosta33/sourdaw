import { logger } from '#/infra/logger/appLogger';
import { releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

type PreparedStemResource = {
    audioBufferId: string;
    assetHash?: string;
    assetLeaseId?: string;
};

const pendingCleanup = new Map<string, PreparedStemResource>();
const cleanupInFlight = new Map<string, Promise<void>>();

function cleanupKey(stem: PreparedStemResource): string {
    return `${stem.audioBufferId}\u0000${stem.assetLeaseId ?? ''}\u0000${stem.assetHash ?? ''}`;
}

async function releasePreparedStem(stem: PreparedStemResource): Promise<void> {
    const key = cleanupKey(stem);
    const existing = cleanupInFlight.get(key);
    if (existing) {
        return existing;
    }
    const release = (async () => {
        releasePreviewAudioBuffer(stem.audioBufferId);
        if (!stem.assetLeaseId && !stem.assetHash) {
            pendingCleanup.delete(key);
            return;
        }
        if (!stem.assetLeaseId || !stem.assetHash) {
            throw new Error('Prepared stem durable asset binding is incomplete');
        }
        const assetTransfer = getAssetTransfer();
        if (!assetTransfer) {
            throw new Error(`Asset transfer is unavailable for staged lease: ${stem.assetLeaseId}`);
        }
        const released = await assetTransfer.releaseDurableStagedAsset(stem.assetLeaseId, stem.assetHash);
        if (released.status === 'failed') {
            throw new Error(`Could not release prepared stem asset ${stem.assetLeaseId}: ${released.reason}`);
        }
        pendingCleanup.delete(key);
    })().finally(() => {
        cleanupInFlight.delete(key);
    });
    cleanupInFlight.set(key, release);
    return release;
}

async function discardPreparedStemImportResources(stems: readonly PreparedStemResource[]): Promise<void> {
    for (const stem of stems) {
        pendingCleanup.set(cleanupKey(stem), stem);
    }
    const failures: unknown[] = [];
    for (const stem of stems) {
        try {
            await releasePreparedStem(stem);
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, 'Prepared stem resource cleanup remains pending');
    }
}

/** Preserve the primary operation outcome while retaining exact cleanup identities for retry. */
async function discardPreparedStemImportResourcesBestEffort(stems: readonly PreparedStemResource[]): Promise<void> {
    try {
        await discardPreparedStemImportResources(stems);
    } catch (error) {
        logger.error(new Error('Prepared stem resource cleanup remains retryable', { cause: error }));
    }
}

/** Explicitly retry every exact durable lease still owned by cleanup. */
function retryPendingPreparedStemImportResourceCleanup(): Promise<void> {
    return discardPreparedStemImportResources([...pendingCleanup.values()]);
}

export const preparedStemImportCleanup = {
    discard: discardPreparedStemImportResources,
    discardBestEffort: discardPreparedStemImportResourcesBestEffort,
    retryPending: retryPendingPreparedStemImportResourceCleanup,
} as const;
