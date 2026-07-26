import { describe, expect, it } from 'vitest';

import { clampDeviceParameterValue, isDeviceParameterAutomatable } from '../DeviceParameterLaw';

// Asserted against the real shipped descriptors rather than a fixture: the
// point of these functions is that the declared contract binds, so a fixture
// that declares its own contract would be testing nothing.

describe('clampDeviceParameterValue', () => {
    it('pins a value above the declared maximum to that maximum', () => {
        expect(clampDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'mix', value: 4.2 })).toBe(1);
    });

    it('pins a value below the declared minimum to that minimum', () => {
        expect(clampDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'predelay', value: -75 })).toBe(0);
    });

    it('leaves a value inside the declared range exactly as it was', () => {
        expect(clampDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'predelay', value: 137.5 })).toBe(137.5);
    });

    it('binds a non-automatable parameter to its range too — the flag is a separate law', () => {
        expect(clampDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'shimmer_pitch', value: 900 })).toBe(1);
    });

    it('passes a value through untouched when the device declares no contract', () => {
        // Faust devices and hosted plugins discover their parameters, so an
        // absent descriptor means "unconstrained", not "forbidden".
        expect(clampDeviceParameterValue({ deviceType: 'no-such-device', paramId: 'mix', value: 999 })).toBe(999);
        expect(clampDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'no-such-param', value: 999 })).toBe(999);
    });
});

describe('isDeviceParameterAutomatable', () => {
    it('refuses a parameter the descriptor declares non-automatable', () => {
        expect(isDeviceParameterAutomatable({ deviceType: 'dutch-oven', paramId: 'shimmer_pitch' })).toBe(false);
    });

    it('allows a parameter the descriptor declares automatable', () => {
        expect(isDeviceParameterAutomatable({ deviceType: 'dutch-oven', paramId: 'mix' })).toBe(true);
    });

    it('allows anything the device declares no contract for', () => {
        expect(isDeviceParameterAutomatable({ deviceType: 'no-such-device', paramId: 'mix' })).toBe(true);
        expect(isDeviceParameterAutomatable({ deviceType: 'dutch-oven', paramId: 'no-such-param' })).toBe(true);
    });
});
