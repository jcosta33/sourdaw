import { describe, it, expect, vi, beforeEach } from 'vitest';

import { normalizeTrack, type Track } from '../../models/Track';
import { persistDeviceParam } from '../persistDeviceParam';
import { defaultTrackState, trackStore } from '../trackStore';

function makeTrack(id: string, deviceId: string): Track {
    return normalizeTrack({
        id,
        name: id,
        kind: 'audio',
        devices: [
            {
                id: deviceId,
                name: 'Device',
                type: 'effect',
                bypassed: false,
                parameterValues: { gain: 0.1 },
            },
        ],
    });
}

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

describe('persistDeviceParam (stores)', () => {
    beforeEach(() => {
        trackStore.set(null);
    });

    it('is a no-op when value is not finite', () => {
        const set = vi.spyOn(trackStore, 'set');
        trackStore.set({ tracks: [], selectedTrackId: null });
        set.mockClear();

        persistDeviceParam('d1', 'gain', Number.NaN);

        expect(set).not.toHaveBeenCalled();
    });

    it('is a no-op when store is uninitialised', () => {
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDeviceParam('d1', 'gain', 0.5);

        expect(set).not.toHaveBeenCalled();
    });

    it('is a no-op when no track owns the device', () => {
        trackStore.set({
            tracks: [{ id: 't1', devices: [], clips: [] }] as any,
            selectedTrackId: null,
        });
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDeviceParam('missing', 'gain', 0.5);

        expect(set).not.toHaveBeenCalled();
    });

    it('writes the new parameter value onto the owning device only', () => {
        const firstTrack = makeTrack('t1', 'd1');
        firstTrack.devices.push({
            id: 'd2',
            name: 'Other device',
            type: 'effect',
            bypassed: false,
            parameterValues: {},
        });
        trackStore.set({
            ...defaultTrackState,
            tracks: [firstTrack, makeTrack('t2', 'd3')],
        });

        persistDeviceParam('d1', 'gain', 0.8);

        const updated = trackStore.value!;
        const device = updated.tracks[0]!.devices.find((candidate) => candidate.id === 'd1');
        expect(device?.parameterValues.gain).toBe(0.8);
        // Other devices / tracks untouched
        const other = updated.tracks[0]!.devices.find((candidate) => candidate.id === 'd2');
        expect(other?.parameterValues).toEqual({});
    });

    it.each([
        ['a VCA owner', [setRuntimeKind(makeTrack('vca-1', 'd1'), 'vca')]],
        ['duplicate owners', [makeTrack('t1', 'd1'), makeTrack('t2', 'd1')]],
    ])('does not persist a parameter for %s', (_label, tracks) => {
        trackStore.set({ ...defaultTrackState, tracks });
        const before = trackStore.value;
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDeviceParam('d1', 'gain', 0.8);

        expect(set).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual(before);
    });
});
