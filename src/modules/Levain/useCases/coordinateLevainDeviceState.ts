import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction, executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import type { toLevainDeviceState } from '../models/LevainDeviceState';

type DeviceState = ReturnType<typeof toLevainDeviceState>;
type Facet = 'identity' | 'tier';
type PendingDevice = {
    projectIdentity: string;
    ownerId: string;
    expectedState: string;
    latest: Partial<Record<Facet, symbol>>;
    tail?: Promise<void>;
};

const pendingDevices = new Map<string, PendingDevice>();

/** Serialize local facets before creating actions; only our own commit advances the witness. */
export function coordinateLevainDeviceState(
    deviceId: string,
    facet: Facet,
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
    const projectIdentity = captureProjectIdentity();
    let pending = pendingDevices.get(deviceId);
    if (!pending || pending.projectIdentity !== projectIdentity) {
        pending = {
            projectIdentity,
            ownerId: owner.id,
            expectedState: canonicalJson(device.deviceState ?? null),
            latest: {},
        };
        pendingDevices.set(deviceId, pending);
    }
    const entry = pending;
    const request = Symbol();
    entry.latest[facet] = request;
    const currentDevice = () =>
        trackStore.value?.tracks
            .find((track) => track.id === entry.ownerId)
            ?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    const isCurrent = (expected: string) =>
        captureProjectIdentity() === entry.projectIdentity &&
        currentDevice() !== undefined &&
        canonicalJson(currentDevice()?.deviceState ?? null) === expected;
    const run = async (): Promise<void> => {
        if (entry.latest[facet] !== request) {
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
        const execute = facet === 'tier' ? executeUserAppAction : executeAppAction;
        await execute(
            { type: 'setDeviceState', payload: { deviceId, state } },
            {
                skipMacroRecording: true,
                shouldExecute: () => {
                    if (entry.latest[facet] !== request) {
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
        if (pendingDevices.get(deviceId) === entry && entry.tail === result) {
            pendingDevices.delete(deviceId);
        }
    });
    entry.tail = result;
    return result;
}
