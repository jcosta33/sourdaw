import { type captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clampDeviceParamWrite } from '../../../stores/clampDeviceParamWrite';
import { resolveEligibleDeviceWriteTarget } from '../../../stores/resolveEligibleDeviceWriteTarget';
import { trackStore } from '../../../stores/trackStore';

import { setDeviceParameter } from './setDeviceParameter';

type Parameter = {
    deviceType: string;
    id: string;
    defaultValue: number;
    failureMessage: string;
    cancelQueuedWrite: () => void;
    captureRuntimeAuthority: typeof captureDeviceParameterRuntimeWriteAuthority;
};

function readParameterOwner(deviceId: string, parameter: Parameter) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return undefined;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === target.trackId);
    const device = track?.devices.find((candidate) => candidate.id === deviceId);
    if (!track || device?.type !== parameter.deviceType) {
        return undefined;
    }
    return {
        deviceId,
        parameter,
        trackId: track.id,
        project: captureProjectIdentity(),
        frozen: track.frozen,
        deviceIds: track.devices.map(({ id }) => id),
        baseline: {
            present: Object.hasOwn(device.parameterValues, parameter.id),
            value: device.parameterValues[parameter.id],
        },
    };
}

type ParameterOwner = NonNullable<ReturnType<typeof readParameterOwner>>;
type RuntimeAuthority = ReturnType<typeof captureDeviceParameterRuntimeWriteAuthority>;
type ParameterGesture = {
    owner: ParameterOwner;
    token: number;
    hasEditAuthority: () => boolean;
    runtime: RuntimeAuthority;
    preview?: number;
    predecessor?: PendingParameter;
    deferredPreview?: number;
};
type PendingParameter = {
    owner: ParameterOwner;
    value: number;
    runtime: RuntimeAuthority;
    committed: Promise<boolean>;
};
type ParameterControl = {
    deviceId: string;
    parameter: Parameter;
    show: (value: number | undefined) => void;
    mounted: boolean;
    token: number;
    gesture?: ParameterGesture;
    pending?: PendingParameter;
};

function sameDevice(owner: ParameterOwner, current: ParameterOwner): boolean {
    return (
        owner.project === current.project && owner.trackId === current.trackId && owner.deviceId === current.deviceId
    );
}

function sameOwner(owner: ParameterOwner, current: ParameterOwner | undefined): boolean {
    return (
        current !== undefined &&
        sameDevice(owner, current) &&
        owner.frozen === current.frozen &&
        owner.deviceIds.length === current.deviceIds.length &&
        owner.deviceIds.every((id, i) => id === current.deviceIds[i])
    );
}

function stillOwnsRuntime(owner: ParameterOwner, runtime: RuntimeAuthority): boolean {
    const current = readParameterOwner(owner.deviceId, owner.parameter);
    return current !== undefined && sameDevice(owner, current) && runtime.canCommit();
}

function baselineMatches(owner: ParameterOwner, current: ParameterOwner | undefined): boolean {
    return (
        current !== undefined &&
        sameOwner(owner, current) &&
        owner.baseline.present === current.baseline.present &&
        Object.is(owner.baseline.value, current.baseline.value)
    );
}

function reportError(error: unknown, parameter: Parameter): void {
    notifyUser(error instanceof Error ? error.message : parameter.failureMessage, 'error');
}

function releaseUnusedRuntime(control: ParameterControl, runtime: RuntimeAuthority): void {
    if (control.gesture?.runtime !== runtime && control.pending?.runtime !== runtime) {
        runtime.release();
    }
}

function writePreview(gesture: ParameterGesture, value: number): boolean {
    return setDeviceParameter(gesture.owner.deviceId, gesture.owner.parameter.id, value, {
        transient: true,
        automationRecordingPolicy: 'suppressed',
        runtimeOwner: gesture.runtime.owner,
    });
}

function restorePreview(gesture: ParameterGesture): void {
    const { owner, runtime, preview } = gesture;
    if (preview === undefined || !runtime.isCurrent() || !runtime.canCommit()) {
        return;
    }
    const latest = readParameterOwner(owner.deviceId, owner.parameter);
    if (!latest || !sameDevice(owner, latest)) {
        return;
    }
    try {
        const restored = latest.baseline.value ?? owner.parameter.defaultValue;
        if (restored !== preview) {
            writePreview(gesture, restored);
        }
    } catch (error) {
        reportError(error, owner.parameter);
    }
}

function cancelHeldGesture(control: ParameterControl): void {
    const { gesture } = control;
    if (gesture) {
        delete control.gesture;
        restorePreview(gesture);
        releaseUnusedRuntime(control, gesture.runtime);
    }
    if (control.mounted) {
        control.show(control.pending?.value);
    }
}

function acquireGesture(control: ParameterControl): number {
    cancelHeldGesture(control);
    control.token += 1;
    const owner = readParameterOwner(control.deviceId, control.parameter);
    const authority = projectTransitionEpoch.captureEditAuthority();
    if (!control.mounted || !owner || !authority.isCurrent()) {
        return control.token;
    }
    const pending = control.pending;
    const predecessor = pending && sameOwner(pending.owner, owner) ? pending : undefined;
    const runtime =
        predecessor?.runtime ??
        owner.parameter.captureRuntimeAuthority(owner.trackId, owner.deviceId, owner.parameter.id);
    control.gesture = { owner, token: control.token, hasEditAuthority: authority.isCurrent, runtime, predecessor };
    return control.token;
}

function gestureOwnerMatches(gesture: ParameterGesture, current: ParameterOwner | undefined): boolean {
    // Our own queued edits may publish intermediate baselines. While waiting
    // for their receipt, this gesture can update only its local display.
    if (gesture.predecessor) {
        return sameOwner(gesture.owner, current);
    }
    return baselineMatches(gesture.owner, current);
}

function gestureIsCurrent(control: ParameterControl, token: string | number): boolean {
    const { gesture } = control;
    if (!gesture || gesture.token !== token) {
        return false;
    }
    const ownerMatches = gestureOwnerMatches(gesture, readParameterOwner(control.deviceId, control.parameter));
    if (!gesture.hasEditAuthority() || !ownerMatches || !gesture.runtime.canCommit()) {
        cancelHeldGesture(control);
        return false;
    }
    return true;
}

async function commitParameter(
    gesture: ParameterGesture,
    owner: ParameterOwner,
    value: number,
    previous: PendingParameter | undefined
): Promise<boolean> {
    const { deviceId, trackId, frozen, deviceIds, baseline, parameter } = owner;
    const { hasEditAuthority, runtime } = gesture;
    function canCommit(): boolean {
        return hasEditAuthority() && runtime.canCommit();
    }
    const receipt = { committed: false };
    try {
        if (previous && !(await previous.committed)) {
            return false;
        }
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId,
                    paramId: parameter.id,
                    value,
                    expectedTrackId: trackId,
                    expectedDeviceType: parameter.deviceType,
                    expectedDeviceIds: deviceIds,
                    expectedTrackFrozen: frozen,
                    expectedValuePresent: baseline.present,
                    expectedValue: baseline.value,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: () => canCommit() && baselineMatches(owner, readParameterOwner(deviceId, parameter)),
                shouldCommit: () => canCommit() && sameOwner(owner, readParameterOwner(deviceId, parameter)),
                deviceParameterRuntimeAuthority: {
                    trackId,
                    deviceId,
                    paramId: parameter.id,
                    owner: runtime.owner,
                    isCurrent: () => stillOwnsRuntime(owner, runtime),
                },
                onCommitted: () => {
                    receipt.committed = true;
                },
            }
        );
    } catch (error) {
        reportError(error, owner.parameter);
    } finally {
        if (!receipt.committed) {
            restorePreview(gesture);
        }
    }
    return receipt.committed;
}

function settleHeldGesture(control: ParameterControl, predecessor: PendingParameter, committed: boolean): void {
    const gesture = control.gesture;
    if (gesture?.predecessor !== predecessor) {
        control.show(gesture?.preview);
        return;
    }
    if (!committed) {
        cancelHeldGesture(control);
        return;
    }
    const value = gesture.deferredPreview;
    delete gesture.predecessor;
    delete gesture.deferredPreview;
    gesture.owner = { ...gesture.owner, baseline: { present: true, value: predecessor.value } };
    if (!gestureIsCurrent(control, gesture.token)) {
        return;
    }
    if (value === undefined) {
        control.show(undefined);
        return;
    }
    previewParameter(control, gesture, value);
}

async function awaitPendingParameter(control: ParameterControl, pending: PendingParameter): Promise<void> {
    let didCommit = false;
    try {
        didCommit = await pending.committed;
    } finally {
        const isLatest = control.pending === pending;
        if (isLatest) {
            delete control.pending;
        }
        try {
            if (isLatest && control.mounted) {
                settleHeldGesture(control, pending, didCommit);
            }
        } finally {
            releaseUnusedRuntime(control, pending.runtime);
        }
    }
}

function queueParameter(control: ParameterControl, gesture: ParameterGesture, value: number): void {
    delete control.gesture;
    const { owner: originalOwner } = gesture;
    const previous = gesture.predecessor;
    // Consecutive key presses build on the immediately preceding intent. Its
    // committed receipt and the expected parameter guard both have to agree.
    const owner = previous ? { ...originalOwner, baseline: { present: true, value: previous.value } } : originalOwner;
    if (value === (owner.baseline.value ?? owner.parameter.defaultValue)) {
        restorePreview(gesture);
        releaseUnusedRuntime(control, gesture.runtime);
        control.show(previous?.value);
        return;
    }
    const committed = commitParameter(gesture, owner, value, previous);
    const pending = { owner, value, runtime: gesture.runtime, committed };
    control.pending = pending;
    control.show(value);
    void awaitPendingParameter(control, pending);
}

function previewParameter(control: ParameterControl, gesture: ParameterGesture, value: number): void {
    try {
        if (!writePreview(gesture, value)) {
            cancelHeldGesture(control);
            return;
        }
        gesture.preview = value;
        control.show(value);
    } catch (error) {
        if (value !== (gesture.owner.baseline.value ?? control.parameter.defaultValue)) {
            gesture.preview = value;
        }
        cancelHeldGesture(control);
        reportError(error, control.parameter);
    }
}

function changeParameter(control: ParameterControl, rawValue: number, transient = false): void {
    if (!Number.isFinite(rawValue)) {
        return;
    }
    const token = control.gesture?.token ?? acquireGesture(control);
    if (!gestureIsCurrent(control, token) || !control.gesture) {
        return;
    }
    const { parameter } = control;
    parameter.cancelQueuedWrite();
    const value = clampDeviceParamWrite({ deviceId: control.deviceId, paramId: parameter.id, value: rawValue });
    if (transient) {
        if (control.gesture.predecessor) {
            control.gesture.deferredPreview = value;
            control.show(value);
            return;
        }
        previewParameter(control, control.gesture, value);
        return;
    }
    queueParameter(control, control.gesture, value);
}

/** One mounted control owns the preview, while Arrangement owns every edit. */
export function createDeviceParameterControl(
    deviceId: string,
    parameter: Parameter,
    show: (value: number | undefined) => void
) {
    const control: ParameterControl = { deviceId, parameter, show, mounted: false, token: 0 };
    return {
        connect() {
            control.mounted = true;
            const stop = trackStore.subscribe(() => {
                if (control.gesture) {
                    gestureIsCurrent(control, control.gesture.token);
                }
            });
            return () => {
                control.mounted = false;
                stop();
                cancelHeldGesture(control);
            };
        },
        gestureAuthority: {
            acquire: () => acquireGesture(control),
            isCurrent: (token: string | number) => gestureIsCurrent(control, token),
        },
        change: (value: number, transient?: boolean) => changeParameter(control, value, transient),
        cancel: () => cancelHeldGesture(control),
    };
}
