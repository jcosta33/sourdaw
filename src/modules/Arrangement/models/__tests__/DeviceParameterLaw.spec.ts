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

    it('lets the sub-0.1 Hz LFO rates shipped content actually uses reach the engine unchanged', () => {
        // Nebula Drift and the `synth-pad-dark-drone` factory preset ship
        // phaser and auto-pan rates below the 0.1 Hz the panel knob offers, and
        // an automation lane rides one of them down to 0.07. The handlers
        // assign these straight to an `OscillatorNode.frequency`
        // (applyPhaserParams, applyAutoPanParams), which has no such floor — so
        // 0.1 was the knob's floor, never the engine's. Clamping to it would
        // run every one of those LFOs 1.4-2x fast.
        expect(clampDeviceParameterValue({ deviceType: 'builtin-phaser', paramId: 'phaser-rate', value: 0.05 })).toBe(
            0.05
        );
        expect(clampDeviceParameterValue({ deviceType: 'builtin-phaser', paramId: 'phaser-rate', value: 0.08 })).toBe(
            0.08
        );
        expect(clampDeviceParameterValue({ deviceType: 'builtin-autopan', paramId: 'autopan-rate', value: 0.06 })).toBe(
            0.06
        );
        expect(clampDeviceParameterValue({ deviceType: 'builtin-autopan', paramId: 'autopan-rate', value: 0.07 })).toBe(
            0.07
        );
    });

    it('lets a zero filter resonance through, which the synth itself generates', () => {
        // `factory-bass-sub` ships `filterResonance: 0`, and
        // scheduleBuiltinSynthNote assigns it to a `BiquadFilterNode.Q` — whose
        // own MPE-slide branch computes `(slide / 127) * 20`, i.e. 0 at rest.
        // The engine produces the value the descriptor claimed was illegal.
        expect(clampDeviceParameterValue({ deviceType: 'builtin-synth', paramId: 'filterResonance', value: 0 })).toBe(
            0
        );
    });

    it('still pins a rate below the widened engine floor', () => {
        // Widening the floor to the engine's domain is not removing it: a
        // negative LFO rate is still refused.
        expect(clampDeviceParameterValue({ deviceType: 'builtin-phaser', paramId: 'phaser-rate', value: -3 })).toBe(0);
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
