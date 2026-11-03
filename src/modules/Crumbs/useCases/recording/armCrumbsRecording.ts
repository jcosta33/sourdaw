import { logger } from '#/infra/logger/appLogger';

import { armRecording } from '../../repositories/crumbsBridge/armRecording';
import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';
import {
    createCrumbsRecordingRequest,
    crumbsRecordingOwners,
    isCrumbsRecordingTerminal,
    refreshCrumbsRecordingReadout,
    setCrumbsRecordingPhase,
    type AcceptedCrumbsTake,
    type CrumbsRecordingRequest,
} from '../../stores/crumbsRecordingStore';
import { padStore } from '../../stores/padStore';

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

async function cancelLateAdmission(
    instanceId: string,
    request: CrumbsRecordingRequest,
    accepted: AcceptedCrumbsTake | null
): Promise<void> {
    if (!accepted || request.stopSent) {
        return;
    }
    request.stopSent = true;
    try {
        await stopRecording(instanceId, accepted.take_id);
    } catch (error) {
        logger.warn(`[Crumbs] could not cancel late take admission: ${String(error)}`);
    }
}

/** Resolves on token admission only; first input and threshold arrive natively. */
export async function armCrumbsRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<boolean> {
    const owner = crumbsRecordingOwners.get(instanceId);
    const padCount = Math.min(padStore.value?.[instanceId]?.pads.length ?? 0, 16);
    if (
        !owner?.active ||
        padCount === 0 ||
        owner.request ||
        (owner.latest && !isCrumbsRecordingTerminal(owner.latest.phase))
    ) {
        return false;
    }
    const safeThreshold = clamp(threshold, 0, 1);
    const safeTargetPad = clamp(Math.round(targetPad), 0, padCount - 1);
    const safeMaxDuration = Number.isFinite(maxDurationSecs) && maxDurationSecs > 0 ? Math.min(maxDurationSecs, 60) : 1;
    const acceptance = owner.setup.then(() => {
        if (!owner.active) {
            return null;
        }
        return armRecording(instanceId, safeThreshold, safeTargetPad, safeMaxDuration);
    });
    const request = createCrumbsRecordingRequest(acceptance);
    owner.request = request;
    refreshCrumbsRecordingReadout(instanceId, owner);
    try {
        const accepted = await acceptance;
        if (request.disposed || !owner.active || crumbsRecordingOwners.get(instanceId) !== owner) {
            await cancelLateAdmission(instanceId, request, accepted);
            return false;
        }
        if (!accepted) {
            owner.request = null;
            refreshCrumbsRecordingReadout(instanceId, owner);
            return false;
        }
        request.takeId = accepted.take_id;
        refreshCrumbsRecordingReadout(instanceId, owner);
        return true;
    } catch (error) {
        if (owner.active && crumbsRecordingOwners.get(instanceId) === owner && owner.request === request) {
            owner.request = null;
            setCrumbsRecordingPhase(instanceId, 'failed', String(error));
        }
        throw error;
    }
}
