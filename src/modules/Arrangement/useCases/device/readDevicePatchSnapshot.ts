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

export function readDevicePatchSnapshot(document: Readonly<Record<string, unknown>>, input: Input): Snapshot | null {
    if (!isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const owners: Located[] = [];
    const values: unknown[] = [];
    let selectedTrack: Record<string, unknown> | null = null;
    let trackValue: TrackCapture = { present: false };
    for (const track of document.tracks.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string') {
            return null;
        }
        const devices = Object.hasOwn(track, 'devices') ? track.devices : [];
        if (!Array.isArray(devices)) {
            return null;
        }
        const deviceIds = devices.map((device: unknown) => (isRecord(device) ? device.id : undefined));
        if (deviceIds.some((id) => typeof id !== 'string')) {
            return null;
        }
        if (track.id === input.trackId) {
            if (selectedTrack) {
                return null;
            }
            selectedTrack = track;
            trackValue = { present: true, deviceIds, frozen: entry(track, 'frozen') };
        }
        for (const device of devices) {
            if (!isRecord(device) || device.id !== input.deviceId) {
                continue;
            }
            if (!isRecord(device.parameterValues)) {
                return null;
            }
            const parameters: Record<string, unknown> = {};
            for (const key of input.parameterIds) {
                parameters[key] = entry(device.parameterValues, key);
            }
            owners.push({ trackId: track.id, device });
            values.push({ trackId: track.id, type: device.type, state: entry(device, 'deviceState'), parameters });
        }
    }
    if (owners.length > 1) {
        return null;
    }
    return { value: { track: trackValue, owners: values }, track: selectedTrack, owners };
}
