import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '../../../models/Track';
import { createTrack } from '../../createTrack';
import { applyDevicePatchState } from '../applyDevicePatchState';

const io = vi.hoisted(() => ({
    read: vi.fn<() => { tracks: Track[] }>(),
    publish: vi.fn<(trackId: string, update: (track: Track) => Track) => void>(),
    target: vi.fn(() => ({ status: 'eligible' as const, trackId: 'owner', deviceId: 'synth' })),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: io.read }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: io.publish }));
vi.mock('../../../stores/resolveEligibleDeviceWriteTarget', () => ({ resolveEligibleDeviceWriteTarget: io.target }));

describe('applyDevicePatchState', () => {
    let track: Track;

    beforeEach(() => {
        track = {
            ...createTrack({ id: 'owner', name: 'Owner', kind: 'midi', withoutDefaultDevice: true }),
            gain: 0.61,
            devices: [
                {
                    id: 'synth',
                    type: 'fermenter',
                    name: 'Custom alias',
                    bypassed: false,
                    parameterValues: { filterCutoff: 600, unrelatedLeaf: 0.7 },
                },
                { id: 'other', type: 'fermenter', name: 'Other', bypassed: false, parameterValues: {} },
            ],
        };
        io.read.mockImplementation(() => ({ tracks: [track] }));
        io.publish.mockImplementation((_trackId, update) => {
            track = update(track);
        });
        io.publish.mockClear();
    });

    afterEach(() => vi.clearAllMocks());

    it('publishes the chunk and explicit leaves once, then restores exact absence without changing unrelated state', () => {
        const original = track;
        const before = { deviceState: null, parameterValues: { filterCutoff: 600, filterModel: null } };
        const after = {
            deviceState: { version: 1, data: { label: 'new patch' } },
            parameterValues: { filterCutoff: 1800, filterModel: 2 },
        };
        expect(applyDevicePatchState({ deviceId: 'synth', expected: before, next: after })).toBe(true);
        expect(io.publish).toHaveBeenCalledOnce();
        expect(track.devices[0]).toEqual({
            ...original.devices[0],
            deviceState: after.deviceState,
            parameterValues: { filterCutoff: 1800, filterModel: 2, unrelatedLeaf: 0.7 },
        });
        expect(track.devices[1]).toBe(original.devices[1]);
        expect(track.gain).toBe(original.gain);

        expect(applyDevicePatchState({ deviceId: 'synth', expected: after, next: before })).toBe(true);
        expect(io.publish).toHaveBeenCalledTimes(2);
        expect(track.devices[0]).toEqual(original.devices[0]);
        expect(Object.hasOwn(track.devices[0]!, 'deviceState')).toBe(false);
        expect(Object.hasOwn(track.devices[0]!.parameterValues, 'filterModel')).toBe(false);
        expect(track.devices[1]).toBe(original.devices[1]);
        expect(track.gain).toBe(0.61);
    });

    it('clamps every specified value before publishing', () => {
        expect(
            applyDevicePatchState({
                deviceId: 'synth',
                expected: { deviceState: null, parameterValues: { filterCutoff: 600, filterResonance: null } },
                next: { deviceState: null, parameterValues: { filterCutoff: -100, filterResonance: 999 } },
            })
        ).toBe(true);
        expect(track.devices[0]!.parameterValues).toEqual({
            filterCutoff: 20,
            filterResonance: 20,
            unrelatedLeaf: 0.7,
        });
        expect(io.publish).toHaveBeenCalledOnce();
    });

    it.each(['presence', 'value', 'chunk', 'footprint', 'invalid value'])(
        'refuses a changed %s without publishing any partial write',
        (change) => {
            const expected: Parameters<typeof applyDevicePatchState>[0]['expected'] = {
                deviceState: null,
                parameterValues: { filterCutoff: 600, filterModel: null },
            };
            const next: Parameters<typeof applyDevicePatchState>[0]['next'] = {
                deviceState: { version: 1, data: { label: 'replacement' } },
                parameterValues: { filterCutoff: 1800, filterModel: 2 },
            };
            if (change === 'presence') {
                track.devices[0]!.parameterValues.filterModel = 0;
            } else if (change === 'value') {
                track.devices[0]!.parameterValues.filterCutoff = 700;
            } else if (change === 'chunk') {
                track.devices[0]!.deviceState = { version: 1, data: { label: 'successor' } };
            } else if (change === 'footprint') {
                next.parameterValues.other = 1;
            } else {
                next.parameterValues.filterModel = Number.NaN;
            }
            const before = structuredClone(track);
            expect(applyDevicePatchState({ deviceId: 'synth', expected, next })).toBe(false);
            expect(io.publish).not.toHaveBeenCalled();
            expect(track).toEqual(before);
        }
    );
});
