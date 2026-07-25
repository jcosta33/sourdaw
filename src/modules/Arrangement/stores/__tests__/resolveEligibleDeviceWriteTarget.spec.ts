import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { normalizeTrack, type Track } from '../../models/Track';
import { resolveEligibleDeviceWriteTarget } from '../resolveEligibleDeviceWriteTarget';
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
                parameterValues: {},
            },
        ],
    });
}

function makeTrackWithoutDevices(id: string): Track {
    return normalizeTrack({
        id,
        name: id,
        kind: 'audio',
        devices: [],
    });
}

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ ...defaultTrackState, tracks });
}

describe('resolveEligibleDeviceWriteTarget', () => {
    beforeEach(() => {
        setTracks([]);
    });

    afterEach(() => {
        setTracks([]);
    });

    it('returns stable IDs only for one eligible owner', () => {
        setTracks([makeTrack('track-1', 'device-1')]);

        const outcome = resolveEligibleDeviceWriteTarget('device-1');

        expect(outcome).toEqual({ status: 'eligible', trackId: 'track-1', deviceId: 'device-1' });
        if (outcome.status === 'eligible') {
            expectTypeOf(outcome.trackId).toEqualTypeOf<string>();
            expectTypeOf(outcome.deviceId).toEqualTypeOf<string>();
        }
    });

    it('distinguishes a missing device from forbidden ownership', () => {
        setTracks([makeTrack('track-1', 'device-1')]);

        expect(resolveEligibleDeviceWriteTarget('missing')).toEqual({ status: 'missing' });

        const vcaTrack = setRuntimeKind(makeTrack('vca-1', 'device-1'), 'vca');
        setTracks([vcaTrack]);
        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({ status: 'ineligible' });
    });

    it.each([
        [
            'eligible owner first',
            [makeTrack('track-1', 'duplicate'), setRuntimeKind(makeTrack('vca-1', 'duplicate'), 'vca')],
        ],
        [
            'ineligible owner first',
            [setRuntimeKind(makeTrack('vca-1', 'duplicate'), 'vca'), makeTrack('track-1', 'duplicate')],
        ],
        [
            'duplicate entries on one owner',
            [
                normalizeTrack({
                    ...makeTrack('track-1', 'duplicate'),
                    devices: [
                        makeTrack('source-a', 'duplicate').devices[0]!,
                        makeTrack('source-b', 'duplicate').devices[0]!,
                    ],
                }),
            ],
        ],
    ])('fails closed for malformed ownership: %s', (_label, tracks) => {
        setTracks(tracks);

        expect(resolveEligibleDeviceWriteTarget('duplicate')).toEqual({ status: 'ineligible' });
    });

    it('fails closed for an unexpected runtime track kind', () => {
        setTracks([setRuntimeKind(makeTrack('future-1', 'device-1'), 'future-kind')]);

        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({ status: 'ineligible' });
    });

    it('fails closed for an empty device ID', () => {
        setTracks([makeTrack('track-1', '')]);

        expect(resolveEligibleDeviceWriteTarget('')).toEqual({ status: 'ineligible' });
    });

    it('fails closed for an empty owner track ID', () => {
        setTracks([makeTrack('', 'device-1')]);

        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({ status: 'ineligible' });
    });

    it.each([
        ['device owner first', true],
        ['device owner second', false],
    ] as const)('fails closed for duplicate track identity with the %s', (_label, deviceOwnerFirst) => {
        const deviceOwner = makeTrack('duplicate-track', 'device-1');
        const collidingTrack = makeTrackWithoutDevices('duplicate-track');
        const tracks = deviceOwnerFirst ? [deviceOwner, collidingTrack] : [collidingTrack, deviceOwner];
        setTracks(tracks);

        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({ status: 'ineligible' });
    });

    it('skips a corrupted non-object track entry and resolves the valid owner', () => {
        setTracks([null as unknown as Track, makeTrack('track-1', 'device-1')]);

        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        });
    });

    it('skips a track whose devices field is not an array and resolves the valid owner', () => {
        const trackWithBadDevices = makeTrackWithoutDevices('track-bad');
        Reflect.set(trackWithBadDevices, 'devices', 'not-an-array');
        setTracks([trackWithBadDevices, makeTrack('track-1', 'device-1')]);

        expect(resolveEligibleDeviceWriteTarget('device-1')).toEqual({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        });
    });
});
