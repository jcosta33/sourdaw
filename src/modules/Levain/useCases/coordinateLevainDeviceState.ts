import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import { getLevainDeviceStateProjectAccess } from '../stores/levainDeviceStateProjectAccess';

import type { toLevainDeviceState } from '../models/LevainDeviceState';
import type { LevainDeviceStateProjectAccess } from '../stores/levainDeviceStateProjectAccess';

type DeviceState = ReturnType<typeof toLevainDeviceState>;
type PendingDevice = {
    projectIdentity: string;
    ownerId: string;
    expectedState: string;
    latest?: symbol;
    tail?: Promise<void>;
    projectAccess: LevainDeviceStateProjectAccess;
    retired: boolean;
    retire: () => void;
    dispose: () => void;
};

const pendingDevices = new Map<string, PendingDevice>();

function createPendingDevice(
    deviceId: string,
    ownerId: string,
    projectIdentity: string,
    projectAccess: LevainDeviceStateProjectAccess,
    expectedState: string
): PendingDevice {
    const unsubscribers: (() => void)[] = [];
    const dispose = (): void => {
        for (const unsubscribe of unsubscribers.splice(0)) {
            unsubscribe();
        }
    };
    const pending: PendingDevice = {
        projectIdentity,
        ownerId,
        expectedState,
        projectAccess,
        retired: false,
        retire: () => {
            target.retired = true;
            dispose();
        },
        dispose,
    };
    const target = pending;
    let seenCommitted = projectAccess.hasDevice(ownerId, deviceId);
    const observeMembership = (): void => {
        if (target.retired) {
            return;
        }
        if (getLevainDeviceStateProjectAccess() !== projectAccess || captureProjectIdentity() !== projectIdentity) {
            target.retire();
            return;
        }
        if (projectAccess.hasDevice(ownerId, deviceId)) {
            seenCommitted = true;
            return;
        }
        const visible = trackStore.value?.tracks
            .find((track) => track.id === ownerId)
            ?.devices.some((candidate) => candidate.id === deviceId && candidate.type === 'levain');
        // A visible add may still be pending; a committed loss can never revive this queue.
        if (seenCommitted || !visible) {
            target.retire();
        }
    };
    pendingDevices.set(deviceId, pending);
    unsubscribers.push(projectAccess.subscribe(observeMembership));
    unsubscribers.push(trackStore.subscribe(observeMembership));
    observeMembership();
    if (target.retired) {
        dispose();
    }
    return pending;
}

/** Serialize layout choices before dispatch. Only the committing action advances its witness. */
export function coordinateLevainDeviceState(
    deviceId: string,
    createState: (prior: DeviceState | undefined) => DeviceState | undefined,
    onStale?: () => void
): Promise<void> {
    const owner = trackStore.value?.tracks.find((track) =>
        track.devices.some((device) => device.id === deviceId && device.type === 'levain')
    );
    const device = owner?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    if (!owner || !device || (device.deviceState && device.deviceState.version !== 1)) {
        return Promise.resolve();
    }
    const projectAccess = getLevainDeviceStateProjectAccess();
    if (!projectAccess) {
        return Promise.reject(new Error('Levain device-state project access is not configured'));
    }
    const projectIdentity = captureProjectIdentity();
    let pending = pendingDevices.get(deviceId);
    if (
        pending &&
        (pending.projectIdentity !== projectIdentity ||
            pending.ownerId !== owner.id ||
            pending.projectAccess !== projectAccess)
    ) {
        pending.retire();
    }
    if (!pending || pending.retired) {
        pending = createPendingDevice(
            deviceId,
            owner.id,
            projectIdentity,
            projectAccess,
            canonicalJson(device.deviceState ?? null)
        );
    }
    const entry = pending;
    const request = Symbol();
    entry.latest = request;
    const currentDevice = () =>
        trackStore.value?.tracks
            .find((track) => track.id === entry.ownerId)
            ?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    const isCurrent = (expected: string) =>
        !entry.retired &&
        getLevainDeviceStateProjectAccess() === entry.projectAccess &&
        captureProjectIdentity() === entry.projectIdentity &&
        currentDevice() !== undefined &&
        canonicalJson(currentDevice()?.deviceState ?? null) === expected;
    const run = async (): Promise<void> => {
        if (entry.latest !== request) {
            return;
        }
        const capturedState = entry.expectedState;
        if (!isCurrent(capturedState)) {
            onStale?.();
            return;
        }
        const state = createState(currentDevice()?.deviceState);
        if (!state) {
            return;
        }
        const committedState = canonicalJson(state);
        await executeUserAppAction(
            { type: 'setDeviceState', payload: { deviceId, state } },
            {
                skipMacroRecording: true,
                shouldExecute: () => {
                    if (entry.latest !== request) {
                        return false;
                    }
                    if (isCurrent(capturedState)) {
                        return true;
                    }
                    onStale?.();
                    return false;
                },
                onCommitted: () => {
                    // Never bless a post-await read: peer writes may already have replaced it.
                    entry.expectedState = committedState;
                },
            }
        );
    };
    const action = entry.tail ? entry.tail.then(run) : run();
    const result = action.finally(() => {
        if (entry.tail === result) {
            entry.dispose();
            if (pendingDevices.get(deviceId) === entry) {
                pendingDevices.delete(deviceId);
            }
        }
    });
    entry.tail = result;
    return result;
}
