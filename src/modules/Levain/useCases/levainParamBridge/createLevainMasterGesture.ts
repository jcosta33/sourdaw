import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue, setDeviceParameter } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRootIdentity } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getLevainDeviceStateProjectAccess } from '../../stores/levainDeviceStateProjectAccess';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { readLevainMasterGain } from '../readLevainMasterGain';

import { levainBridge } from './levainBridge';

const PARAMETER = 'masterGain';

function readOwner(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return undefined;
    }
    const track = trackStore.value?.tracks.find(({ id }) => id === target.trackId);
    const device = track?.devices.find(({ id }) => id === deviceId);
    return track && device?.type === 'levain' ? { track, device } : undefined;
}

function captureOwner(deviceId: string) {
    const owner = readOwner(deviceId);
    if (!owner || owner.track.frozen || !levainStore.value?.[deviceId]) {
        return undefined;
    }
    const { track, device } = owner;
    const bridge = levainBridge();
    const isRegistered = bridge.captureMasterRegistration(deviceId);
    const project = captureProjectIdentity();
    const root = captureProjectRootIdentity();
    const access = getLevainDeviceStateProjectAccess();
    if (!isRegistered() || bridge.isMasterGainQueued(deviceId) || (access && !access.hasDevice(track.id, deviceId))) {
        return undefined;
    }

    const deviceIds = track.devices.map(({ id }) => id);
    const expectedValuePresent = Object.hasOwn(device.parameterValues, PARAMETER);
    const expectedValue = device.parameterValues[PARAMETER];
    const expectedLegacyValue = device.parameterValues.master_gain;
    function readOriginalOwner() {
        if (
            captureProjectIdentity() !== project ||
            captureProjectRootIdentity() !== root ||
            !isRegistered() ||
            access !== getLevainDeviceStateProjectAccess()
        ) {
            return undefined;
        }
        const current = readOwner(deviceId);
        return current?.track.id === track.id ? current : undefined;
    }
    function readUnchangedTopology() {
        const current = readOriginalOwner();
        if (
            !current ||
            bridge.isMasterGainQueued(deviceId) ||
            current.track.frozen !== track.frozen ||
            current.track.devices.length !== deviceIds.length ||
            current.track.devices.some(({ id }, index) => id !== deviceIds[index])
        ) {
            return undefined;
        }
        return current.device;
    }
    function valueIsUnchanged(): boolean {
        const current = readUnchangedTopology();
        return (
            current !== undefined &&
            Object.hasOwn(current.parameterValues, PARAMETER) === expectedValuePresent &&
            Object.is(current.parameterValues[PARAMETER], expectedValue) &&
            (expectedValuePresent || Object.is(current.parameterValues.master_gain, expectedLegacyValue))
        );
    }
    const runtime = captureDeviceParameterRuntimeWriteAuthority(track.id, deviceId, PARAMETER);
    function sendPreview(value: number): boolean {
        return setDeviceParameter(deviceId, PARAMETER, value, {
            transient: true,
            automationRecordingPolicy: 'suppressed',
            runtimeOwner: runtime.owner,
        });
    }
    return {
        access,
        hasCommittedOwner: () => !access || access.hasDevice(track.id, deviceId),
        runtime,
        sendPreview,
        readOriginalOwner,
        readUnchangedTopology,
        valueIsUnchanged,
        valueAtStart: readLevainMasterGain(device.parameterValues, defaultLevainState.patch.masterGain),
        guards: {
            expectedTrackId: track.id,
            expectedDeviceType: 'levain',
            expectedDeviceIds: deviceIds,
            expectedTrackFrozen: track.frozen,
            expectedValuePresent,
            expectedValue,
        },
    };
}

type Gesture = NonNullable<ReturnType<typeof captureOwner>> & {
    token: number;
    preview?: number;
    settling: boolean;
    invalidated: boolean;
    stop: () => void;
};

function createGesture(
    owner: NonNullable<ReturnType<typeof captureOwner>>,
    token: number,
    unsubscribers: Array<() => void>
): Gesture {
    return {
        ...owner,
        token,
        settling: false,
        invalidated: false,
        stop() {
            for (const unsubscribe of unsubscribers.splice(0)) {
                unsubscribe();
            }
        },
    };
}

function restorePreview(current: Gesture): void {
    if (
        current.preview === undefined ||
        !current.runtime.isCurrent() ||
        !current.runtime.canCommit() ||
        !current.hasCommittedOwner()
    ) {
        return;
    }
    const owner = current.readOriginalOwner();
    if (!owner) {
        return;
    }
    const value = readLevainMasterGain(owner.device.parameterValues, defaultLevainState.patch.masterGain);
    if (value !== current.preview) {
        current.sendPreview(value);
    }
}

function releaseRuntimeAuthority(current: Gesture, committed: boolean): void {
    try {
        if (!committed) {
            restorePreview(current);
        }
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Levain Master preview could not be restored', 'error');
    } finally {
        current.runtime.release();
    }
}

function subscribeToGestureOwner(
    current: Gesture,
    unsubscribers: Array<() => void>,
    invalidate: (gesture: Gesture) => void
): void {
    function observe(): void {
        if (current.invalidated) {
            return;
        }
        if (current.settling ? !current.readUnchangedTopology() : !current.valueIsUnchanged()) {
            invalidate(current);
        }
    }
    unsubscribers.push(trackStore.subscribe(observe), levainStore.subscribe(observe));
    if (current.access) {
        unsubscribers.push(
            current.access.subscribe(() => {
                if (!current.invalidated && !current.hasCommittedOwner()) {
                    invalidate(current);
                } else {
                    observe();
                }
            })
        );
    }
}

function previewGesture(
    current: Gesture,
    value: number,
    showPreview: (value?: number) => void,
    invalidate: (gesture: Gesture) => void
): void {
    try {
        if (current.sendPreview(value)) {
            current.preview = value;
            showPreview(value);
        }
    } catch (error) {
        invalidate(current);
        notifyUser(error instanceof Error ? error.message : 'Levain Master preview failed', 'error');
    }
}

async function commitGesture(
    deviceId: string,
    current: Gesture,
    value: number,
    finish: (gesture: Gesture, committed: boolean) => void
): Promise<void> {
    current.settling = true;
    let committed = false;
    try {
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId,
                    paramId: PARAMETER,
                    value,
                    ...current.guards,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: () => !current.invalidated && current.valueIsUnchanged() && current.runtime.canCommit(),
                shouldCommit: () => !current.invalidated && current.readUnchangedTopology() !== undefined,
                deviceParameterRuntimeAuthority: {
                    trackId: current.guards.expectedTrackId,
                    deviceId,
                    paramId: PARAMETER,
                    owner: current.runtime.owner,
                    isCurrent: () => current.readOriginalOwner() !== undefined && current.runtime.canCommit(),
                },
                onCommitted: () => {
                    committed = true;
                },
            }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Levain Master change failed', 'error');
    } finally {
        finish(current, committed);
    }
}

/** Own a mounted Desk control's transient display and its one terminal action. */
export function createLevainMasterGesture(deviceId: string, showPreview: (value?: number) => void) {
    let sequence = 0;
    let gesture: Gesture | undefined;

    function finish(current: Gesture, committed: boolean): void {
        current.stop();
        if (gesture === current) {
            gesture = undefined;
            showPreview();
        }
        releaseRuntimeAuthority(current, committed);
    }

    function invalidate(current: Gesture): void {
        current.invalidated = true;
        if (!current.settling) {
            finish(current, false);
        } else {
            showPreview();
        }
    }

    function start(): number {
        if (gesture?.settling) {
            return -1;
        }
        if (gesture) {
            finish(gesture, false);
        }
        const owner = captureOwner(deviceId);
        if (!owner) {
            return -1;
        }
        const unsubscribers: Array<() => void> = [];
        const current = createGesture(owner, ++sequence, unsubscribers);
        gesture = current;
        subscribeToGestureOwner(current, unsubscribers, invalidate);
        return current.token;
    }

    function isCurrent(token: string | number): boolean {
        return gesture?.token === token && !gesture.invalidated;
    }

    function change(value: number, transient = false): void {
        if (!Number.isFinite(value)) {
            return;
        }
        if (!gesture && !transient) {
            start();
        }
        const current = gesture;
        if (!current || current.settling || current.invalidated) {
            return;
        }
        if (!current.valueIsUnchanged() || !current.runtime.canCommit()) {
            invalidate(current);
            return;
        }
        const bounded = clampDeviceParameterValue({ deviceType: 'levain', paramId: PARAMETER, value });
        if (transient) {
            previewGesture(current, bounded, showPreview, invalidate);
        } else if (bounded === current.valueAtStart) {
            finish(current, false);
        } else {
            void commitGesture(deviceId, current, bounded, finish);
        }
    }

    return {
        start,
        isCurrent,
        change,
        dispose: () => {
            if (gesture) {
                invalidate(gesture);
            }
        },
    };
}
