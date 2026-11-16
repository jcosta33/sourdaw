import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { isRecord } from '#/utils/structuralEquality';

function withoutDeviceStateChunks(track: unknown): unknown {
    if (!isRecord(track) || !Array.isArray(track.devices)) {
        return track;
    }
    const devices: unknown[] = track.devices.map((device: unknown) => {
        if (!isRecord(device)) {
            return device;
        }
        const { externalStateChunk: _stateChunk, ...withoutChunk } = device;
        return withoutChunk;
    });
    return { ...track, devices };
}

function parseFingerprint(fingerprint: string): { valid: true; value: unknown } | { valid: false } {
    try {
        return { valid: true, value: JSON.parse(fingerprint) };
    } catch {
        return { valid: false };
    }
}

/**
 * Whether a created track still matches the fingerprint its creation left, with every
 * device's `externalStateChunk` set aside on both sides. A save writes the live plugin
 * state through the non-undoable `setExternalPluginState` capture, which no user gesture
 * authored and no undo entry protects; the same rule as `deviceMatches` in
 * `handleRestoreTrackClipStates`. Every other field, device fields included, still counts.
 */
export function matchesCreatedTrackFingerprint(track: unknown, fingerprint: string): boolean {
    const parsed = parseFingerprint(fingerprint);
    if (!parsed.valid) {
        return false;
    }
    return matchesJsonFingerprint(
        withoutDeviceStateChunks(track),
        JSON.stringify(withoutDeviceStateChunks(parsed.value))
    );
}
