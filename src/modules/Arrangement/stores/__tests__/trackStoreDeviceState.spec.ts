import { describe, expect, it } from 'vitest';

import { sanitizeTrackSnapshot } from '../trackStore';

/**
 * The CRDT projection normalizes devices field-by-field against a whitelist, so a
 * device field it does not copy is dropped on every save/load and collaboration
 * round-trip — the failure that once lost every native plugin's `externalStateChunk`.
 * `deviceState` is the structured, versioned equivalent for built-in devices.
 *
 * The disposition under test is the one `normalize_freeze_state` establishes: a
 * malformed chunk costs the device its state and nothing else. It must never drop the
 * device, the track or the document, because a chunk is written by whichever module
 * owns the device and a version this build does not recognise is an ordinary value,
 * not a corrupt project.
 */

const deviceBase = {
    id: 'dev-1',
    name: 'Toaster',
    type: 'toaster',
    bypassed: false,
    parameterValues: { masterGain: 1 },
};

function snapshotWithDevice(device: Record<string, unknown>): Record<string, unknown> {
    return {
        tracks: [{ id: 'track-1', name: 'Track 1', kind: 'midi', devices: [device] }],
        selectedTrackId: 'track-1',
    };
}

describe('sanitizeTrackSnapshot — device state chunk', () => {
    it('preserves a structured chunk, nested containers and all leaf types', () => {
        const deviceState = {
            version: 1,
            data: {
                kit: {
                    name: 'Plain Bread',
                    pads: [{ name: 'Kick', muted: false, volume: 0.8, engineType: 'kick-808' }],
                    steps: [true, false, true],
                    unset: null,
                },
            },
        };

        const result = sanitizeTrackSnapshot(snapshotWithDevice({ ...deviceBase, deviceState }));

        expect(result.tracks[0]?.devices[0]?.deviceState).toEqual(deviceState);
    });

    it('keeps a version it does not recognise, so the owning module decides what to do with it', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithDevice({ ...deviceBase, deviceState: { version: 99, data: { anything: 'here' } } })
        );

        expect(result.tracks[0]?.devices[0]?.deviceState?.version).toBe(99);
    });

    it.each([
        ['a chunk with no version', { data: { kit: {} } }],
        ['a non-numeric version', { version: 'one', data: { kit: {} } }],
        ['a non-finite version', { version: Number.NaN, data: { kit: {} } }],
        ['a chunk with no data', { version: 1 }],
        ['data that is not a container', { version: 1, data: 'kit' }],
        ['data that is an array', { version: 1, data: ['kit'] }],
        ['a junk scalar in the slot', 7],
        ['a string in the slot', 'kit'],
    ])('drops %s while the device itself still loads', (_label, deviceState) => {
        const result = sanitizeTrackSnapshot(snapshotWithDevice({ ...deviceBase, deviceState }));

        const device = result.tracks[0]?.devices[0];
        expect(device?.deviceState).toBeUndefined();
        // The load must not be collateral damage: an unreadable chunk degrades the
        // device to "has no saved state", which is what a fresh device looks like.
        expect(device?.id).toBe('dev-1');
        expect(device?.parameterValues).toEqual({ masterGain: 1 });
        expect(result.tracks).toHaveLength(1);
    });

    it('strips values the document cannot store while keeping the rest of the chunk', () => {
        const result = sanitizeTrackSnapshot(
            snapshotWithDevice({
                ...deviceBase,
                deviceState: {
                    version: 1,
                    data: { kept: 'yes', broken: Number.NaN, alsoBroken: undefined, keptToo: 3 },
                },
            })
        );

        // NaN and undefined survive an Automerge write but not the JSON round-trip the
        // `.sourdaw` snapshot takes, so a chunk carrying one would reload as a
        // different value than it was saved as.
        expect(result.tracks[0]?.devices[0]?.deviceState?.data).toEqual({ kept: 'yes', keptToo: 3 });
    });

    it('leaves the field absent when the device carries no chunk', () => {
        const result = sanitizeTrackSnapshot(snapshotWithDevice({ ...deviceBase }));

        expect(result.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
    });
});
