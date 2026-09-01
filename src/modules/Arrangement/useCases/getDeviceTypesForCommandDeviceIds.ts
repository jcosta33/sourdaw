import { getTrackStoreState } from './getTrackStoreState';

function readNonEmptyStringProp(value: object, key: string): string | undefined {
    if (!Object.hasOwn(value, key)) {
        return undefined;
    }
    const candidate: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (typeof candidate === 'string' && candidate !== '') {
        return candidate;
    }
    return undefined;
}

function contractIdentityFromDeviceSnapshot(snapshot: object): string | undefined {
    return readNonEmptyStringProp(snapshot, 'externalPluginId') ?? readNonEmptyStringProp(snapshot, 'type');
}

function resolveDeviceSnapshotTypes(
    argumentsValue: Readonly<Record<string, unknown>>,
    requestedIds: ReadonlySet<string>,
    resolved: Record<string, string>
): void {
    const deviceSnapshot = argumentsValue.deviceSnapshot;
    if (typeof deviceSnapshot !== 'object' || deviceSnapshot === null || Array.isArray(deviceSnapshot)) {
        return;
    }
    const snapshotId = readNonEmptyStringProp(deviceSnapshot, 'id');
    if (snapshotId === undefined || !requestedIds.has(snapshotId) || resolved[snapshotId] !== undefined) {
        return;
    }
    const contractIdentity = contractIdentityFromDeviceSnapshot(deviceSnapshot);
    if (contractIdentity === undefined) {
        return;
    }
    resolved[snapshotId] = contractIdentity;
}

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
                resolved[device.id] = device.externalPluginId ?? device.type;
            }
        }
    }
    resolveDeviceSnapshotTypes(input.argumentsValue, requestedIds, resolved);
    if (
        input.operation === 'addTrack' &&
        input.argumentsValue.kind === 'midi' &&
        typeof input.argumentsValue.initialDeviceId === 'string'
    ) {
        resolved[input.argumentsValue.initialDeviceId] = 'builtin-synth';
    }
    return resolved;
}
