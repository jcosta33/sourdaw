import { getTrackStoreState } from './getTrackStoreState';

export function getDeviceTypesForCommandDeviceIds(input: {
    argumentsValue: Readonly<Record<string, unknown>>;
    deviceIds: readonly string[];
    operation: string;
}): Readonly<Record<string, string>> {
    const requestedIds = new Set(input.deviceIds);
    const resolved: Record<string, string> = {};
    for (const track of getTrackStoreState()?.tracks ?? []) {
        for (const device of track.devices) {
            if (requestedIds.has(device.id)) {
                resolved[device.id] = device.type;
            }
        }
    }
    if (
        input.operation === 'addTrack' &&
        input.argumentsValue.kind === 'midi' &&
        typeof input.argumentsValue.initialDeviceId === 'string'
    ) {
        resolved[input.argumentsValue.initialDeviceId] = 'builtin-synth';
    }
    return resolved;
}
