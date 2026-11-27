import { isRecord } from '#/utils/structuralEquality';

type Input = { trackId: string; deviceId: string; parameterIds: readonly string[] };
type Located = { trackId: string; device: Record<string, unknown> };
type TrackCapture = { present: false } | { present: true; deviceIds: unknown[]; frozen: unknown };
type Snapshot = {
    value: { track: TrackCapture; owners: unknown[] };
    track: Record<string, unknown> | null;
    owners: Located[];
};

function entry(record: Record<string, unknown>, key: string) {
    return Object.hasOwn(record, key) ? { present: true, value: record[key] } : { present: false };
}

function readDeviceChain(track: Record<string, unknown>) {
    const rows: unknown = Object.hasOwn(track, 'devices') ? track.devices : [];
    if (!Array.isArray(rows)) {
        return null;
    }
    const ids = rows.map((device: unknown) => (isRecord(device) ? device.id : undefined));
    if (ids.some((id) => typeof id !== 'string')) {
        return null;
    }
    return { rows, ids };
}

function captureDeviceOwners(snapshot: Snapshot, trackId: string, rows: readonly unknown[], input: Input): boolean {
    for (const device of rows) {
        if (!isRecord(device) || device.id !== input.deviceId) {
            continue;
        }
        if (!isRecord(device.parameterValues)) {
            return false;
        }
        const parameters: Record<string, unknown> = {};
        for (const key of input.parameterIds) {
            parameters[key] = entry(device.parameterValues, key);
        }
        snapshot.owners.push({ trackId, device });
        snapshot.value.owners.push({ trackId, type: device.type, state: entry(device, 'deviceState'), parameters });
    }
    return true;
}

export function readDevicePatchSnapshot(document: Readonly<Record<string, unknown>>, input: Input): Snapshot | null {
    if (!isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const snapshot: Snapshot = { value: { track: { present: false }, owners: [] }, track: null, owners: [] };
    for (const track of document.tracks.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string') {
            return null;
        }
        const chain = readDeviceChain(track);
        if (!chain) {
            return null;
        }
        if (track.id === input.trackId) {
            if (snapshot.track) {
                return null;
            }
            snapshot.track = track;
            snapshot.value.track = { present: true, deviceIds: chain.ids, frozen: entry(track, 'frozen') };
        }
        if (!captureDeviceOwners(snapshot, track.id, chain.rows, input)) {
            return null;
        }
    }
    if (snapshot.owners.length > 1) {
        return null;
    }
    return snapshot;
}
