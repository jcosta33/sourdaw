import { clampDeviceParamWrite, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { DEFAULT_PATCH } from '../../models/BacteriaPatch';

import { paramBatcher } from './helpers';

const INPUT = 'inputGain';

function readInputOwner(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return undefined;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === target.trackId);
    const device = track?.devices.find((candidate) => candidate.id === deviceId);
    if (!track || device?.type !== 'bacteria') {
        return undefined;
    }
    return {
        deviceId,
        trackId: track.id,
        project: captureProjectIdentity(),
        frozen: track.frozen,
        deviceIds: track.devices.map(({ id }) => id),
        baseline: {
            present: Object.hasOwn(device.parameterValues, INPUT),
            value: device.parameterValues[INPUT],
        },
    };
}

type InputOwner = NonNullable<ReturnType<typeof readInputOwner>>;
type RuntimeAuthority = ReturnType<typeof captureDeviceParameterRuntimeWriteAuthority>;
type InputGesture = {
    owner: InputOwner;
    token: number;
    hasEditAuthority: () => boolean;
    runtime: RuntimeAuthority;
    preview?: number;
    predecessor?: PendingInput;
    deferredPreview?: number;
};
type PendingInput = {
    owner: InputOwner;
    value: number;
    runtime: RuntimeAuthority;
    committed: Promise<boolean>;
};
type InputControl = {
    deviceId: string;
    show: (value: number | undefined) => void;
    mounted: boolean;
    token: number;
    gesture?: InputGesture;
    pending?: PendingInput;
};

function sameDevice(owner: InputOwner, current: InputOwner): boolean {
    return (
        owner.project === current.project && owner.trackId === current.trackId && owner.deviceId === current.deviceId
    );
}

function sameOwner(owner: InputOwner, current: InputOwner | undefined): boolean {
    return (
        current !== undefined &&
        sameDevice(owner, current) &&
        owner.frozen === current.frozen &&
        owner.deviceIds.length === current.deviceIds.length &&
        owner.deviceIds.every((id, i) => id === current.deviceIds[i])
    );
}

function stillOwnsRuntime(owner: InputOwner, runtime: RuntimeAuthority): boolean {
    const current = readInputOwner(owner.deviceId);
    return current !== undefined && sameDevice(owner, current) && runtime.canCommit();
}

function baselineMatches(owner: InputOwner, current: InputOwner | undefined): boolean {
    return (
        current !== undefined &&
        sameOwner(owner, current) &&
        owner.baseline.present === current.baseline.present &&
        Object.is(owner.baseline.value, current.baseline.value)
    );
}

function reportInputError(error: unknown): void {
    notifyUser(error instanceof Error ? error.message : 'Unable to change Bacteria Input gain', 'error');
}

function releaseUnusedRuntime(control: InputControl, runtime: RuntimeAuthority): void {
    if (control.gesture?.runtime !== runtime && control.pending?.runtime !== runtime) {
        runtime.release();
    }
}

function writeInputPreview(gesture: InputGesture, value: number): boolean {
    return setDeviceParameter(gesture.owner.deviceId, INPUT, value, {
        transient: true,
        automationRecordingPolicy: 'suppressed',
        runtimeOwner: gesture.runtime.owner,
    });
}

function restorePreview(gesture: InputGesture): void {
    const { owner, runtime, preview } = gesture;
    if (preview === undefined || !runtime.isCurrent() || !runtime.canCommit()) {
        return;
    }
    const latest = readInputOwner(owner.deviceId);
    if (!latest || !sameDevice(owner, latest)) {
        return;
    }
    try {
        const restored = latest.baseline.value ?? DEFAULT_PATCH.inputGain;
        if (restored !== preview) {
            writeInputPreview(gesture, restored);
        }
    } catch (error) {
        reportInputError(error);
    }
}

function cancelHeldGesture(control: InputControl): void {
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

function acquireGesture(control: InputControl): number {
    cancelHeldGesture(control);
    control.token += 1;
    const owner = readInputOwner(control.deviceId);
    const authority = projectTransitionEpoch.captureEditAuthority();
    if (!control.mounted || !owner || !authority.isCurrent()) {
        return control.token;
    }
    const pending = control.pending;
    const predecessor = pending && sameOwner(pending.owner, owner) ? pending : undefined;
    const runtime =
        predecessor?.runtime ?? captureDeviceParameterRuntimeWriteAuthority(owner.trackId, owner.deviceId, INPUT);
    control.gesture = { owner, token: control.token, hasEditAuthority: authority.isCurrent, runtime, predecessor };
    return control.token;
}

function gestureIsCurrent(control: InputControl, token: string | number): boolean {
    const { gesture } = control;
    if (!gesture || gesture.token !== token) {
        return false;
    }
    const current = readInputOwner(control.deviceId);
    // Our own queued edits may publish intermediate baselines. While waiting
    // for their receipt, this gesture can update only its local display.
    const ownerMatches = gesture.predecessor
        ? sameOwner(gesture.owner, current)
        : baselineMatches(gesture.owner, current);
    if (!gesture.hasEditAuthority() || !ownerMatches || !gesture.runtime.canCommit()) {
        cancelHeldGesture(control);
        return false;
    }
    return true;
}

async function commitInput(
    gesture: InputGesture,
    owner: InputOwner,
    value: number,
    previous: PendingInput | undefined
): Promise<boolean> {
    const { deviceId, trackId, frozen, deviceIds, baseline } = owner;
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
                    paramId: INPUT,
                    value,
                    expectedTrackId: trackId,
                    expectedDeviceType: 'bacteria',
                    expectedDeviceIds: deviceIds,
                    expectedTrackFrozen: frozen,
                    expectedValuePresent: baseline.present,
                    expectedValue: baseline.value,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: () => canCommit() && baselineMatches(owner, readInputOwner(deviceId)),
                shouldCommit: () => canCommit() && sameOwner(owner, readInputOwner(deviceId)),
                deviceParameterRuntimeAuthority: {
                    trackId,
                    deviceId,
                    paramId: INPUT,
                    owner: runtime.owner,
                    isCurrent: () => stillOwnsRuntime(owner, runtime),
                },
                onCommitted: () => {
                    receipt.committed = true;
                },
            }
        );
    } catch (error) {
        reportInputError(error);
    } finally {
        if (!receipt.committed) {
            restorePreview(gesture);
        }
    }
    return receipt.committed;
}

function settleHeldGesture(control: InputControl, predecessor: PendingInput, committed: boolean): void {
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
    previewInput(control, gesture, value);
}

async function awaitPendingInput(control: InputControl, pending: PendingInput): Promise<void> {
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

function queueInput(control: InputControl, gesture: InputGesture, value: number): void {
    delete control.gesture;
    const { owner: originalOwner } = gesture;
    const previous = gesture.predecessor;
    // Consecutive key presses build on the immediately preceding intent. Its
    // committed receipt and the expected parameter guard both have to agree.
    const owner = previous ? { ...originalOwner, baseline: { present: true, value: previous.value } } : originalOwner;
    if (value === (owner.baseline.value ?? DEFAULT_PATCH.inputGain)) {
        restorePreview(gesture);
        releaseUnusedRuntime(control, gesture.runtime);
        control.show(previous?.value);
        return;
    }
    const committed = commitInput(gesture, owner, value, previous);
    const pending = { owner, value, runtime: gesture.runtime, committed };
    control.pending = pending;
    control.show(value);
    void awaitPendingInput(control, pending);
}

function previewInput(control: InputControl, gesture: InputGesture, value: number): void {
    try {
        if (!writeInputPreview(gesture, value)) {
            cancelHeldGesture(control);
            return;
        }
        gesture.preview = value;
        control.show(value);
    } catch (error) {
        if (value !== (gesture.owner.baseline.value ?? DEFAULT_PATCH.inputGain)) {
            gesture.preview = value;
        }
        cancelHeldGesture(control);
        reportInputError(error);
    }
}

function changeInput(control: InputControl, rawValue: number, transient = false): void {
    if (!Number.isFinite(rawValue)) {
        return;
    }
    const token = control.gesture?.token ?? acquireGesture(control);
    if (!gestureIsCurrent(control, token) || !control.gesture) {
        return;
    }
    paramBatcher.cancel(`${control.deviceId}:${INPUT}`);
    const value = clampDeviceParamWrite({ deviceId: control.deviceId, paramId: INPUT, value: rawValue });
    if (transient) {
        if (control.gesture.predecessor) {
            control.gesture.deferredPreview = value;
            control.show(value);
            return;
        }
        previewInput(control, control.gesture, value);
        return;
    }
    queueInput(control, control.gesture, value);
}

/** One mounted control owns the preview, while Arrangement owns every edit. */
export function createBacteriaInputGainControl(deviceId: string, show: (value: number | undefined) => void) {
    const control: InputControl = { deviceId, show, mounted: false, token: 0 };
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
        change: (value: number, transient?: boolean) => changeInput(control, value, transient),
        cancel: () => cancelHeldGesture(control),
    };
}
