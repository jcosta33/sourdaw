import { describe, it, expect } from 'vitest';

import { sanitizeTrackSnapshot } from '../trackStore';

// PH-3 regression guard. The CRDT projection normalizes devices field-by-field
// (a whitelist), so a device field it does not copy is silently dropped on every
// save/load and collaboration round-trip. Before native plugin state was wired
// through this projection, `externalStateChunk` was exactly such a dropped field
// — reopening a project lost every plugin's saved state.

const deviceBase = {
    id: 'dev-1',
    name: 'Reverb',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalPluginId: 'plugin-abc',
    externalInstanceId: 'plugin-abc-123',
};

function snapshotWithDevice(device: Record<string, unknown>): Record<string, unknown> {
    return {
        tracks: [
            {
                id: 'track-1',
                name: 'Track 1',
                kind: 'audio',
                devices: [device],
            },
        ],
        selectedTrackId: 'track-1',
    };
}

describe('sanitizeTrackSnapshot — native plugin state chunk', () => {
    it('preserves externalStateChunk through the CRDT projection', () => {
        const result = sanitizeTrackSnapshot(snapshotWithDevice({ ...deviceBase, externalStateChunk: 'YmluYXJ5' }));
        expect(result.tracks[0]?.devices[0]?.externalStateChunk).toBe('YmluYXJ5');
    });

    it('leaves externalStateChunk unset when the device has none', () => {
        const result = sanitizeTrackSnapshot(snapshotWithDevice(deviceBase));
        expect(result.tracks[0]?.devices[0]?.externalStateChunk).toBeUndefined();
    });

    it('ignores a non-string externalStateChunk', () => {
        const result = sanitizeTrackSnapshot(snapshotWithDevice({ ...deviceBase, externalStateChunk: 42 }));
        expect(result.tracks[0]?.devices[0]?.externalStateChunk).toBeUndefined();
    });
});
