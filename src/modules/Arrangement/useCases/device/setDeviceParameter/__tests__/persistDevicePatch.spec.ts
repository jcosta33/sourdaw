import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTrack, type Track } from '../../../../models/Track';
import { defaultTrackState, trackStore } from '../../../../stores/trackStore';
import { persistDevicePatch } from '../persistDevicePatch';

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

describe('persistDevicePatch', () => {
    beforeEach(() => {
        trackStore.set(defaultTrackState);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        trackStore.set(defaultTrackState);
    });

    it('persists finite values for one eligible owner', () => {
        trackStore.set({ ...defaultTrackState, tracks: [makeTrack('t1', 'd1')] });

        persistDevicePatch('d1', { gain: 0.8, ignored: Number.NaN, label: 'not-a-number' });

        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({ gain: 0.8 });
    });

    it.each([
        ['a missing owner', []],
        ['a VCA owner', [setRuntimeKind(makeTrack('vca-1', 'd1'), 'vca')]],
        ['duplicate owners', [makeTrack('t1', 'd1'), makeTrack('t2', 'd1')]],
    ])('does not persist a patch for %s', (_label, tracks) => {
        trackStore.set({ ...defaultTrackState, tracks });
        const before = trackStore.value;
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDevicePatch('d1', { gain: 0.8 });

        expect(set).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual(before);
    });
});
