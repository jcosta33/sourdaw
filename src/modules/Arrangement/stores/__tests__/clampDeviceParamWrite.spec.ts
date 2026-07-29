import { describe, it, expect, beforeEach } from 'vitest';

import { normalizeTrack, type Track } from '../../models/Track';
import { clampDeviceParamWrite } from '../clampDeviceParamWrite';
import { trackStore } from '../trackStore';

function trackWithDevice(deviceType: string): Track {
    return normalizeTrack({
        id: 't1',
        name: 't1',
        kind: 'audio',
        devices: [
            {
                id: 'd1',
                name: 'Device',
                type: deviceType,
                bypassed: false,
                parameterValues: {},
            },
        ],
    });
}

function seed(deviceType: string): void {
    trackStore.set({ tracks: [trackWithDevice(deviceType)], selectedTrackId: null });
}

describe('clampDeviceParamWrite', () => {
    beforeEach(() => {
        trackStore.set(null);
    });

    // `dutch-oven` declares `mix` over minValue 0 / maxValue 1. The bounds
    // asserted below are the shipped descriptor's, not a fixture's.
    it('holds an over-range write to the declared maximum', () => {
        seed('dutch-oven');

        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'mix', value: 4.2 })).toBe(1);
    });

    it('holds an under-range write to the declared minimum', () => {
        seed('dutch-oven');

        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'mix', value: -3 })).toBe(0);
    });

    it('passes an in-range write through untouched', () => {
        seed('dutch-oven');

        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'mix', value: 0.42 })).toBe(0.42);
    });

    it('passes through a parameter the descriptor does not declare', () => {
        seed('dutch-oven');

        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'no-such-param', value: 999 })).toBe(999);
    });

    it('passes through a device type that declares no descriptor', () => {
        // Faust devices, hosted plugins and anything with dynamically
        // discovered parameters declare nothing; absence of a descriptor means
        // "no declared contract", not "forbidden".
        seed('faust-reverb');

        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'mix', value: 4.2 })).toBe(4.2);
    });

    it('passes through a device the store does not hold', () => {
        seed('dutch-oven');

        expect(clampDeviceParamWrite({ deviceId: 'absent', paramId: 'mix', value: 4.2 })).toBe(4.2);
    });

    it('passes through when the store is uninitialised', () => {
        // Mid-attach and offline render strips have no reachable declared
        // contract; refusing the write would be worse than passing it.
        expect(clampDeviceParamWrite({ deviceId: 'd1', paramId: 'mix', value: 4.2 })).toBe(4.2);
    });
});
