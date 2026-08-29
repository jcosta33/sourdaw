/**
 * `expectedDeviceIds` is a compare-and-swap precondition: it names the chain the
 * command must find already in place, never a device the command reads or
 * writes. Collecting it here made the command's admissibility depend on every
 * neighbour already on the track, because `commandDeviceVersionsPort` then
 * demands a contract version for each — so one device whose type resolves to no
 * descriptor refused an add that never touched it.
 *
 * `deviceSnapshot` is the restore operand: its identity rides under `id`, which
 * matches neither `deviceId` nor `*DeviceId(s)`. Without collecting that id,
 * restore envelopes capture no versions and deferred re-execution admits stale
 * parameterValues against a drifted descriptor.
 */
function isCommandDeviceIdKey(key: string): boolean {
    if (key === 'expectedDeviceIds') {
        return false;
    }
    return key === 'deviceId' || key.endsWith('DeviceId') || key.endsWith('DeviceIds');
}

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

function collectDeviceSnapshotId(value: object, deviceIds: Set<string>): void {
    const snapshotId = readNonEmptyStringProp(value, 'id');
    if (snapshotId !== undefined) {
        deviceIds.add(snapshotId);
    }
}

function visit(value: unknown, key: string | null, deviceIds: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            visit(item, key, deviceIds);
        }
        return;
    }
    if (typeof value === 'object' && value !== null) {
        if (key === 'deviceSnapshot') {
            collectDeviceSnapshotId(value, deviceIds);
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            visit(childValue, childKey, deviceIds);
        }
        return;
    }
    if (typeof value === 'string' && value !== '' && key !== null && isCommandDeviceIdKey(key)) {
        deviceIds.add(value);
    }
}

export function getCommandDeviceIds(argumentsValue: Readonly<Record<string, unknown>>): string[] {
    const deviceIds = new Set<string>();
    visit(argumentsValue, null, deviceIds);
    return [...deviceIds].sort();
}
