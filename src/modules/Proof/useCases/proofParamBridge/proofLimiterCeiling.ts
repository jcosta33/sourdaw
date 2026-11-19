import { captureDeviceParameterRuntimeWriteAuthority, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { isValidProofPatch } from '../../services/isValidProofPatch';
import { getProofState, updateProofPatch } from '../../stores/proofStore';

import {
    CEILING_PARAMETER,
    proofLimiterCeilingProjection,
    proofLimiterCeilingRecord,
    type CeilingProjection,
    type CeilingRecord,
} from './reconcileProofLimiterCeiling';

type CeilingSettlement = { done: Promise<void>; ownerIsCurrent: () => boolean };
type CeilingGesture = {
    baseline: CeilingRecord;
    deviceId: string;
    trackId: string;
    deviceIds: string[];
    frozen: boolean;
    ownerIsCurrent: () => boolean;
    isAdmissible: () => boolean;
    runtime: ReturnType<typeof captureDeviceParameterRuntimeWriteAuthority>;
    cancelled?: boolean;
    preview?: number;
    settlement?: CeilingSettlement;
};
const gestures = new WeakMap<CeilingProjection, CeilingGesture>();

function releaseCeilingGesture(scope: CeilingProjection, gesture: CeilingGesture): void {
    gesture.runtime.release();
    gestures.delete(scope);
    delete scope.cancelGesture;
    delete scope.ceilingForSync;
}

function discardProofLimiterCeilingGesture(deviceId: string): void {
    proofLimiterCeilingProjection.get(deviceId)?.cancelGesture?.();
}

function acquireCeilingGesture(deviceId: string, scope: CeilingProjection): CeilingGesture | undefined {
    const owner = scope.readOwner();
    if (!owner) {
        return undefined;
    }
    const { track, device } = owner;
    const { id: trackId, frozen } = track;
    const deviceIds = track.devices.map(({ id }) => id);
    const baseline = proofLimiterCeilingRecord.read(device.parameterValues);
    const runtime = captureDeviceParameterRuntimeWriteAuthority(trackId, deviceId, CEILING_PARAMETER);
    function readExpectedOwner() {
        const current = scope.readOwner();
        return current?.track.frozen === frozen &&
            current.track.devices.length === deviceIds.length &&
            current.track.devices.every(({ id }, index) => id === deviceIds[index])
            ? current
            : undefined;
    }
    const gesture: CeilingGesture = {
        baseline,
        deviceId,
        trackId,
        deviceIds,
        frozen,
        runtime,
        ownerIsCurrent: () =>
            !gesture.cancelled &&
            proofLimiterCeilingProjection.get(deviceId) === scope &&
            readExpectedOwner() !== undefined,
        isAdmissible: () => {
            const current = readExpectedOwner();
            return (
                gestures.get(scope) === gesture &&
                proofLimiterCeilingProjection.get(deviceId) === scope &&
                current !== undefined &&
                proofLimiterCeilingRecord.equals(
                    baseline,
                    proofLimiterCeilingRecord.read(current.device.parameterValues)
                ) &&
                runtime.canCommit()
            );
        },
    };
    gestures.set(scope, gesture);
    scope.ceilingForSync = (value) => {
        if (!Object.is(value, gesture.preview)) {
            return { value };
        }
        if (gesture.isAdmissible()) {
            return { value, runtimeOwner: runtime.owner };
        }
        const latest = scope.readOwner();
        const record = latest ? proofLimiterCeilingRecord.read(latest.device.parameterValues) : baseline;
        return { value: proofLimiterCeilingRecord.valueForDisplay(record) };
    };
    scope.cancelGesture = () => {
        gesture.cancelled = true;
        releaseCeilingGesture(scope, gesture);
    };
    return gesture;
}

function restoreCeilingPreview(deviceId: string, scope: CeilingProjection, gesture: CeilingGesture): void {
    const owner = scope.readOwner();
    if (!owner || gesture.preview === undefined) {
        return;
    }
    const restored = proofLimiterCeilingRecord.valueForDisplay(
        proofLimiterCeilingRecord.read(owner.device.parameterValues)
    );
    try {
        if (gesture.preview !== restored && gesture.runtime.isCurrent() && gesture.runtime.canCommit()) {
            updateDeviceParam(owner.track.id, deviceId, CEILING_PARAMETER, restored, gesture.runtime.owner);
        }
    } catch (error) {
        notifyUser(
            error instanceof Error ? error.message : 'Proof limiter ceiling preview could not be restored',
            'error'
        );
    } finally {
        if (Object.is(getProofState(deviceId).patch.limCeiling, gesture.preview)) {
            updateProofPatch({ deviceId, patch: { limCeiling: restored }, preservePresetId: true });
        }
    }
}

function cancelHeldProofLimiterCeiling(deviceId: string): void {
    const scope = proofLimiterCeilingProjection.get(deviceId);
    const gesture = scope ? gestures.get(scope) : undefined;
    if (scope && gesture && !gesture.settlement) {
        restoreCeilingPreview(deviceId, scope, gesture);
        discardProofLimiterCeilingGesture(deviceId);
    }
}

async function commitCeiling(
    scope: CeilingProjection,
    gesture: CeilingGesture,
    value: number,
    onCommitted?: () => void
): Promise<void> {
    const { deviceId } = gesture;
    const receipt = { committed: false };
    try {
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId,
                    paramId: CEILING_PARAMETER,
                    value,
                    expectedTrackId: gesture.trackId,
                    expectedDeviceType: 'proof',
                    expectedDeviceIds: gesture.deviceIds,
                    expectedTrackFrozen: gesture.frozen,
                    expectedValuePresent: gesture.baseline.present,
                    expectedValue: gesture.baseline.value,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: gesture.isAdmissible,
                shouldCommit: gesture.ownerIsCurrent,
                deviceParameterRuntimeAuthority: {
                    trackId: gesture.trackId,
                    deviceId,
                    paramId: CEILING_PARAMETER,
                    owner: gesture.runtime.owner,
                    isCurrent: gesture.runtime.canCommit,
                },
                onCommitted: () => {
                    receipt.committed = true;
                    if (gestures.get(scope) === gesture) {
                        if (getProofState(deviceId).patch.presetId !== undefined) {
                            updateProofPatch({ deviceId, patch: { limCeiling: value } });
                        }
                        onCommitted?.();
                    }
                },
            }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Proof limiter ceiling change failed', 'error');
    } finally {
        if (gestures.get(scope) === gesture) {
            try {
                if (!receipt.committed) {
                    restoreCeilingPreview(deviceId, scope, gesture);
                }
            } finally {
                releaseCeilingGesture(scope, gesture);
            }
        }
    }
}

function getProofLimiterCeilingSettlement(deviceId: string): CeilingSettlement | undefined {
    const scope = proofLimiterCeilingProjection.get(deviceId);
    return scope ? gestures.get(scope)?.settlement : undefined;
}

function previewCeiling(gesture: CeilingGesture, value: number): void {
    const { deviceId, trackId, runtime } = gesture;
    if (!gesture.isAdmissible() || Object.is(getProofState(deviceId).patch.limCeiling, value)) {
        return;
    }
    updateDeviceParam(trackId, deviceId, CEILING_PARAMETER, value, runtime.owner);
    gesture.preview = value;
    updateProofPatch({ deviceId, patch: { limCeiling: value }, preservePresetId: true });
}

function setProofLimiterCeiling(
    deviceId: string,
    value: number,
    transient: boolean,
    options?: { requiresPreview?: boolean; onCommitted?: () => void }
): void {
    if (!isValidProofPatch({ ...getProofState(deviceId).patch, limCeiling: value })) {
        return;
    }
    let scope = proofLimiterCeilingProjection.get(deviceId);
    if (!options?.requiresPreview) {
        scope = proofLimiterCeilingProjection.ensure(deviceId);
    }
    if (!scope) {
        return;
    }
    let gesture = gestures.get(scope);
    if (!gesture && !options?.requiresPreview) {
        gesture = acquireCeilingGesture(deviceId, scope);
    }
    if (!gesture || gesture.settlement) {
        return;
    }
    if (transient) {
        previewCeiling(gesture, value);
        return;
    }
    const done = commitCeiling(scope, gesture, value, options?.onCommitted);
    gesture.settlement = { done, ownerIsCurrent: gesture.ownerIsCurrent };
}

export const proofLimiterCeiling = {
    discard: discardProofLimiterCeilingGesture,
    cancelHeld: cancelHeldProofLimiterCeiling,
    settlement: getProofLimiterCeilingSettlement,
    change: setProofLimiterCeiling,
};
