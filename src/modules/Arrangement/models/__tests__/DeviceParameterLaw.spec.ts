import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../DeviceParameter';
import {
    clampDeviceParameterValue,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '../DeviceParameterLaw';

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

describe('quantiseDeviceParameterValue', () => {
    it('rounds a fractional value on an `int` parameter to the nearest legal index', () => {
        // Fermenter's oscillator engine. 0 is its DEFAULT, so a case parked
        // there would agree under both the rounded and the raw path and prove
        // nothing; these drive 2.4 and 4.08 — the first two values the live slew
        // produces on a 0 → 6 ride.
        expect(quantiseDeviceParameterValue({ deviceType: 'fermenter', paramId: 'oscEngine', value: 2.4 })).toBe(2);
        expect(quantiseDeviceParameterValue({ deviceType: 'fermenter', paramId: 'oscEngine', value: 4.08 })).toBe(4);
    });

    it('rounds on a `bool` parameter, so a half-open gate resolves to one side', () => {
        expect(quantiseDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'freeze', value: 0.4 })).toBe(0);
        expect(quantiseDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'freeze', value: 0.6 })).toBe(1);
    });

    it('rounds on a `choice` parameter', () => {
        expect(quantiseDeviceParameterValue({ deviceType: 'builtin-synth', paramId: 'waveform', value: 1.7 })).toBe(2);
    });

    it('rounds a negative index toward the nearer neighbour without producing -0', () => {
        // Fermenter's coarse tune spans -24..24 semitones, so the negative half
        // of an `int` range is real. `Math.round(-0.2)` is `-0`, which compares
        // unequal to 0 under Object.is and would read as a spurious change.
        expect(quantiseDeviceParameterValue({ deviceType: 'fermenter', paramId: 'oscCoarse', value: -7.6 })).toBe(-8);
        expect(
            Object.is(quantiseDeviceParameterValue({ deviceType: 'fermenter', paramId: 'oscCoarse', value: -0.2 }), 0)
        ).toBe(true);
    });

    it('leaves a `float` parameter fractional', () => {
        // Bacteria's `mix` declares step 0.01, which the descriptor builders map
        // to `float`. Rounding it would quantise a continuous wet/dry to on/off.
        expect(quantiseDeviceParameterValue({ deviceType: 'bacteria', paramId: 'mix', value: 0.37 })).toBe(0.37);
        // And a `float` whose declared step is neither 1 nor sub-unit: Grinder's
        // input impedance carries `step: 10`, which is a knob increment, not a
        // legal-value law, and must not be rounded to 1 kΩ either.
        expect(quantiseDeviceParameterValue({ deviceType: 'grinder', paramId: 'inputImpedance', value: 1234.5 })).toBe(
            1234.5
        );
    });

    it('passes a value through untouched when the device declares no contract', () => {
        expect(quantiseDeviceParameterValue({ deviceType: 'no-such-device', paramId: 'mix', value: 2.5 })).toBe(2.5);
        expect(quantiseDeviceParameterValue({ deviceType: 'fermenter', paramId: 'no-such-param', value: 2.5 })).toBe(
            2.5
        );
    });

    it('rounds to the nearest legal step for every stepped parameter in the registry', () => {
        // The premise `Math.round` rests on, asserted over the whole catalog
        // rather than a hand-kept list — the same class of list that has already
        // shipped four times in this repo without Crust in it. If someone adds
        // an `int`/`bool`/`choice` parameter whose declared bounds are not
        // integers, "nearest integer" stops meaning "nearest legal step" and
        // rounding could also leave the declared range. This reds instead.
        const offenders: string[] = [];
        for (const plugin of BUILTIN_PLUGINS) {
            for (const parameter of plugin.parameters) {
                if (parameter.type === 'float') {
                    continue;
                }
                if (!Number.isInteger(parameter.minValue) || !Number.isInteger(parameter.maxValue)) {
                    offenders.push(`${plugin.id}:${parameter.id}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('covers a stepped parameter on every device family that declares one', () => {
        // Derived from the registry, never enumerated by hand: each device that
        // ships a stepped parameter must have that parameter actually quantised,
        // and each case is driven at min + 0.4 of the span — strictly between two
        // legal values, and never at the default for its own sake.
        const uncovered: string[] = [];
        for (const plugin of BUILTIN_PLUGINS) {
            for (const parameter of plugin.parameters) {
                if (parameter.type === 'float') {
                    continue;
                }
                const probe = parameter.minValue + (parameter.maxValue - parameter.minValue) * 0.4 + 0.25;
                const quantised = quantiseDeviceParameterValue({
                    deviceType: plugin.id,
                    paramId: parameter.id,
                    value: probe,
                });
                if (!Number.isInteger(quantised) || quantised < parameter.minValue || quantised > parameter.maxValue) {
                    uncovered.push(`${plugin.id}:${parameter.id} -> ${quantised}`);
                }
            }
        }
        expect(uncovered).toEqual([]);
        // Sanity on the sweep itself: it has to have actually visited stepped
        // parameters, on more than one device.
        const steppedDevices = BUILTIN_PLUGINS.filter((plugin) =>
            plugin.parameters.some((parameter) => parameter.type !== 'float')
        );
        expect(steppedDevices.length).toBe(27);
        expect(steppedDevices.map((plugin) => plugin.id)).toContain('crust');
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
