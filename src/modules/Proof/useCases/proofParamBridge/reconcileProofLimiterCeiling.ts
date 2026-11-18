import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';

import { DEFAULT_PATCH, PROOF_PATCH_RANGES } from '../../models/ProofPatch';
import { getProofState, updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';

export const CEILING_PARAMETER = 'lim_ceiling';

export type CeilingRecord = { present: boolean; value: number | undefined };
export type CeilingProjection = {
    readOwner: () => ReturnType<typeof readProofOwner>;
    stop: () => void;
    cancelGesture?: () => void;
};

const scopes = new Map<string, CeilingProjection>();

function getCeilingProjection(deviceId: string): CeilingProjection | undefined {
    return scopes.get(deviceId);
}

function readProofOwner(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return undefined;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === target.trackId);
    const device = track?.devices.find((candidate) => candidate.id === deviceId);
    return track && device?.type === 'proof' ? { track, device } : undefined;
}

function readCeilingRecord(values: Record<string, number>): CeilingRecord {
    return { present: Object.hasOwn(values, CEILING_PARAMETER), value: values[CEILING_PARAMETER] };
}

function sameCeilingRecord(left: CeilingRecord, right: CeilingRecord): boolean {
    return left.present === right.present && Object.is(left.value, right.value);
}

function ceilingFromRecord({ value }: CeilingRecord): number {
    const [min, max] = PROOF_PATCH_RANGES.limCeiling;
    if (value !== undefined && Number.isFinite(value) && value >= min && value <= max) {
        return value;
    }
    return DEFAULT_PATCH.limCeiling;
}

function stopProofLimiterCeilingReconciliation(deviceId: string): void {
    const scope = scopes.get(deviceId);
    if (scope) {
        scopes.delete(deviceId);
        scope.cancelGesture?.();
        scope.stop();
    }
}

function resetProofLimiterCeilingReconciliation(): void {
    for (const deviceId of scopes.keys()) {
        stopProofLimiterCeilingReconciliation(deviceId);
    }
}

/** The mounted cache follows committed value and presence. The owning action writes the runtime. */
function reconcileProofLimiterCeiling(deviceId: string): CeilingProjection | undefined {
    const existing = scopes.get(deviceId);
    if (existing?.readOwner()) {
        return existing;
    }
    stopProofLimiterCeilingReconciliation(deviceId);
    const owner = readProofOwner(deviceId);
    if (!owner) {
        return undefined;
    }
    const project = captureProjectIdentity();
    const bridge = bridges.get(deviceId);
    const trackId = owner.track.id;
    function readOwner() {
        if (captureProjectIdentity() !== project || bridges.get(deviceId) !== bridge) {
            return undefined;
        }
        const current = readProofOwner(deviceId);
        return current?.track.id === trackId ? current : undefined;
    }

    let committed = readCeilingRecord(owner.device.parameterValues);
    const stop = trackStore.subscribe(() => {
        const current = readOwner();
        if (!current) {
            stopProofLimiterCeilingReconciliation(deviceId);
            return;
        }
        const next = readCeilingRecord(current.device.parameterValues);
        if (!sameCeilingRecord(committed, next)) {
            committed = next;
            projectCeiling(deviceId, ceilingFromRecord(next));
        }
    });
    const scope = { readOwner, stop };
    scopes.set(deviceId, scope);
    projectCeiling(deviceId, ceilingFromRecord(committed));
    return scope;
}

function projectCeiling(deviceId: string, value: number): void {
    const current = getProofState(deviceId).patch;
    if (!Object.is(current.limCeiling, value)) {
        updateProofPatch({ deviceId, patch: { limCeiling: value } });
    }
}

export const proofLimiterCeilingRecord = {
    read: readCeilingRecord,
    equals: sameCeilingRecord,
    valueForDisplay: ceilingFromRecord,
};

export const proofLimiterCeilingProjection = {
    get: getCeilingProjection,
    ensure: reconcileProofLimiterCeiling,
    stop: stopProofLimiterCeilingReconciliation,
    reset: resetProofLimiterCeilingReconciliation,
};
