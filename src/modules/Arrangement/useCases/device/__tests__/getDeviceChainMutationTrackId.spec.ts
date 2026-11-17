import { describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import {
    deviceChainMutationTrackIdByActionType,
    getDeviceChainMutationTrackId,
} from '../getDeviceChainMutationTrackId';

const track = {
    ...createTrack({ id: 'track-1', kind: 'midi', name: 'Track' }),
    devices: [{ id: 'device-1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }],
};

describe('getDeviceChainMutationTrackId', () => {
    it('gives a non-default answer for exactly the device-chain mutations', () => {
        const noMutation = deviceChainMutationTrackIdByActionType.selectTrack;
        const mutatingEntries = Object.entries(deviceChainMutationTrackIdByActionType).filter(
            ([, entry]) => entry !== noMutation
        );
        const mutating = mutatingEntries.map(([type]) => type).sort();
        expect(mutating).toEqual(
            [
                'addDevice',
                'restoreDevice',
                'reorderDevices',
                'loadPreset',
                'restorePresetDeviceChain',
                'removeDevice',
                'loadExternalPlugin',
            ].sort()
        );
    });

    it('reads the payload track of an added device', () => {
        expect(
            getDeviceChainMutationTrackId(
                { type: 'addDevice', payload: { trackId: 'track-9', deviceType: 'eq' } },
                track
            )
        ).toBe('track-9');
    });

    it('reads the payload track of an external plugin load, which may omit it', () => {
        expect(
            getDeviceChainMutationTrackId(
                { type: 'loadExternalPlugin', payload: { pluginId: 'p', trackId: 't' } },
                track
            )
        ).toBe('t');
        expect(getDeviceChainMutationTrackId({ type: 'loadExternalPlugin', payload: { pluginId: 'p' } }, track)).toBe(
            undefined
        );
    });

    it('prefers the expected track of a removed device and else the track holding the device', () => {
        expect(
            getDeviceChainMutationTrackId(
                { type: 'removeDevice', payload: { deviceId: 'device-1', expectedTrackId: 'other' } },
                track
            )
        ).toBe('other');
        expect(getDeviceChainMutationTrackId({ type: 'removeDevice', payload: { deviceId: 'device-1' } }, track)).toBe(
            'track-1'
        );
        expect(getDeviceChainMutationTrackId({ type: 'removeDevice', payload: { deviceId: 'nope' } }, track)).toBe(
            undefined
        );
    });

    it('reads the payload track of a restored, reordered or preset-loaded device chain', () => {
        const deviceSnapshot = { id: 'device-1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} };
        const expectedBefore = { id: 'track-9', kind: 'midi' as const, devices: [] };
        expect(
            getDeviceChainMutationTrackId(
                { type: 'restoreDevice', payload: { trackId: 'track-9', deviceSnapshot, deviceIndex: 0 } },
                track
            )
        ).toBe('track-9');
        expect(
            getDeviceChainMutationTrackId(
                {
                    type: 'reorderDevices',
                    payload: { trackId: 'track-9', deviceId: 'device-1', targetIndex: 0, expectedBefore },
                },
                track
            )
        ).toBe('track-9');
        expect(
            getDeviceChainMutationTrackId(
                {
                    type: 'loadPreset',
                    payload: {
                        presetId: 'preset-1',
                        trackId: 'track-9',
                        expectedBefore,
                        expectedFrozen: false,
                        devices: [],
                    },
                },
                track
            )
        ).toBe('track-9');
        expect(
            getDeviceChainMutationTrackId(
                {
                    type: 'restorePresetDeviceChain',
                    payload: { trackId: 'track-9', expectedBefore, expectedFrozen: false, replacementDevices: [] },
                },
                track
            )
        ).toBe('track-9');
    });

    it('names no track for an action outside the device chain', () => {
        expect(getDeviceChainMutationTrackId({ type: 'selectTrack', payload: { trackId: 'track-1' } }, track)).toBe(
            undefined
        );
    });
});
