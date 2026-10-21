import { logger } from '#/infra/logger/appLogger';

import { getCrumbsRecordingState } from '../../repositories/crumbsBridge/getCrumbsRecordingState';
import { onCrumbsRecordingState } from '../../repositories/crumbsBridge/onCrumbsRecordingState';
import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';
import {
    crumbsRecordingOwners,
    crumbsRecordingStore,
    refreshCrumbsRecordingReadout,
    setCrumbsRecordingPhase,
    type CrumbsRecordingOwner,
    type CrumbsRecordingSnapshot,
} from '../../stores/crumbsRecordingStore';

function projectSnapshot(
    instanceId: string,
    owner: CrumbsRecordingOwner,
    snapshot: CrumbsRecordingSnapshot,
    authoritative: boolean
): void {
    if (!owner.active || crumbsRecordingOwners.get(instanceId) !== owner || snapshot.instance_id !== instanceId) {
        return;
    }
    const previous = owner.latest;
    if (previous) {
        if (snapshot.instance_incarnation !== previous.instance_incarnation) {
            if (BigInt(snapshot.instance_incarnation) < BigInt(previous.instance_incarnation)) {
                return;
            }
            if (!authoritative) {
                void syncCrumbsRecordingState(instanceId, 'reconcile');
                return;
            }
            if (owner.request) {
                owner.request.disposed = true;
                owner.request = null;
            }
        } else if (
            BigInt(snapshot.revision) <= BigInt(previous.revision) ||
            BigInt(snapshot.take_id) < BigInt(previous.take_id)
        ) {
            return;
        }
    }
    if (owner.request?.takeId && snapshot.take_id !== owner.request.takeId) {
        return;
    }
    owner.latest = snapshot;
    refreshCrumbsRecordingReadout(instanceId, owner);
}

function reportFailure(instanceId: string, owner: CrumbsRecordingOwner, error: unknown): void {
    if (!owner.active || crumbsRecordingOwners.get(instanceId) !== owner) {
        return;
    }
    const phase = crumbsRecordingStore.value?.[instanceId]?.phase;
    setCrumbsRecordingPhase(instanceId, phase && phase !== 'idle' ? phase : 'failed', String(error));
    logger.warn(`[Crumbs] recording state unavailable for ${instanceId}: ${String(error)}`);
}

/** Persistent device ownership starts/stops the listener; panels only reconcile. */
export async function syncCrumbsRecordingState(
    instanceId: string,
    operation: 'attach' | 'detach' | 'reconcile' = 'reconcile'
): Promise<void> {
    const existing = crumbsRecordingOwners.get(instanceId);
    if (operation === 'detach') {
        if (!existing) {
            return;
        }
        existing.active = false;
        crumbsRecordingOwners.delete(instanceId);
        existing.unlisten?.();
        const request = existing.request;
        if (request) {
            request.disposed = true;
            void request.acceptance
                .then(async (accepted) => {
                    if (accepted && !request.stopSent) {
                        request.stopSent = true;
                        await stopRecording(instanceId, accepted.take_id);
                    }
                })
                .catch((error: unknown) => logger.warn(`[Crumbs] could not cancel disposed take: ${String(error)}`));
        }
        crumbsRecordingStore.update((current) =>
            Object.fromEntries(Object.entries(current ?? {}).filter(([id]) => id !== instanceId))
        );
        return;
    }
    if (operation === 'attach' && !existing) {
        const owner: CrumbsRecordingOwner = {
            active: true,
            latest: null,
            buffered: null,
            request: null,
            setup: Promise.resolve(),
            reconciling: null,
            unlisten: null,
        };
        crumbsRecordingOwners.set(instanceId, owner);
        owner.setup = (async () => {
            const unlisten = await onCrumbsRecordingState((snapshot) => {
                if (!owner.active || snapshot.instance_id !== instanceId) {
                    return;
                }
                if (!owner.latest) {
                    const buffered = owner.buffered;
                    if (
                        !buffered ||
                        BigInt(snapshot.instance_incarnation) > BigInt(buffered.instance_incarnation) ||
                        (snapshot.instance_incarnation === buffered.instance_incarnation &&
                            BigInt(snapshot.revision) > BigInt(buffered.revision))
                    ) {
                        owner.buffered = snapshot;
                    }
                    return;
                }
                projectSnapshot(instanceId, owner, snapshot, false);
            });
            if (!owner.active) {
                unlisten();
                return;
            }
            owner.unlisten = unlisten;
            const snapshot = await getCrumbsRecordingState(instanceId);
            if (snapshot) {
                projectSnapshot(instanceId, owner, snapshot, true);
            }
            const buffered = owner.buffered;
            owner.buffered = null;
            if (buffered && owner.latest) {
                projectSnapshot(instanceId, owner, buffered, false);
            }
        })().catch((error: unknown) => reportFailure(instanceId, owner, error));
        await owner.setup;
        return;
    }
    if (!existing) {
        return;
    }
    if (operation === 'attach') {
        await existing.setup;
        return;
    }
    if (existing.reconciling) {
        await existing.reconciling;
        return;
    }
    existing.reconciling = (async () => {
        await existing.setup;
        if (!existing.active) {
            return;
        }
        const snapshot = await getCrumbsRecordingState(instanceId);
        if (snapshot) {
            projectSnapshot(instanceId, existing, snapshot, true);
        }
    })().catch((error: unknown) => reportFailure(instanceId, existing, error));
    try {
        await existing.reconciling;
    } finally {
        existing.reconciling = null;
    }
}
