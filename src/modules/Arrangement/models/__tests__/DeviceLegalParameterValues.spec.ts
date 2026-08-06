/**
 * The TypeScript half of the legal-value weld.
 *
 * `DeviceLegalParameterValues.json` states, for every value a declared legal
 * set can be asked about, which setting the engine resolves it to. Rust asserts
 * the second column against its own dispatch (`crates/daw-dsp/tests/
 * legal_parameter_values.rs`, `crates/proof-chamber/tests/
 * legal_parameter_values.rs`); this file asserts that the delivery law and the
 * declared set agree with the same column.
 *
 * That is what makes the fixture a weld rather than a third opinion. Editing
 * one side reds the other: change a Rust arm and its crate's test fails,
 * change the TS set or the resolution direction and this fails, edit the
 * fixture to match one of them and the other fails.
 *
 * The parameter list is read out of the fixture and cross-checked against the
 * registry, so a fourth parameter declaring a legal set has to appear here to
 * be covered — and `everyDeclaringParameterIsCovered` fails until it does.
 */

import { describe, expect, it } from 'vitest';

import fixture from '../DeviceLegalParameterValues.json';
import { BUILTIN_PLUGINS } from '../DeviceParameter';
import { quantiseDeviceParameterValue } from '../DeviceParameterLaw';

type FixtureParameter = {
    deviceType: string;
    paramId: string;
    engine: string;
    resolved: Array<{ raw: number; setting: number }>;
};

const fixtureParameters: FixtureParameter[] = fixture.parameters;

function declaringParameters(): Array<{ identity: string; deviceType: string; paramId: string }> {
    return BUILTIN_PLUGINS.flatMap((plugin) =>
        plugin.parameters.flatMap((parameter) => {
            if (!parameter.legalSet) {
                return [];
            }
            return [{ identity: `${plugin.id}/${parameter.id}`, deviceType: plugin.id, paramId: parameter.id }];
        })
    );
}

function descriptorFor({ deviceType, paramId }: { deviceType: string; paramId: string }) {
    const descriptor = BUILTIN_PLUGINS.find((plugin) => plugin.id === deviceType)?.parameters.find(
        (parameter) => parameter.id === paramId
    );
    if (!descriptor) {
        throw new Error(`${deviceType}/${paramId} is not in the plugin registry`);
    }
    return descriptor;
}

describe('declared legal values against the engines that resolve them', () => {
    it('covers every parameter in the registry that declares a legal set', () => {
        // Derived from the registry, never hand-listed. A new declaration that
        // nobody welded to an engine arm is exactly the defect this change is
        // fixing, so it must not be able to ship uncovered.
        const covered = new Set(fixtureParameters.map((entry) => `${entry.deviceType}/${entry.paramId}`));
        expect([...declaringParameters().map((entry) => entry.identity)].sort()).toEqual([...covered].sort());
    });

    it('delivers, for every value in each declared range, the setting the engine resolves it to', () => {
        for (const { deviceType, paramId, resolved, engine } of fixtureParameters) {
            const descriptor = descriptorFor({ deviceType, paramId });
            const identity = `${deviceType}/${paramId}`;

            // The fixture has to span the declared range exactly — a short
            // fixture would silently stop covering the values that were added.
            const declaredRange: number[] = [];
            for (let value = descriptor.minValue; value <= descriptor.maxValue; value++) {
                declaredRange.push(value);
            }
            expect(
                resolved.map((entry) => entry.raw),
                `${identity}: fixture does not span minValue..maxValue in order`
            ).toEqual(declaredRange);

            for (const { raw, setting } of resolved) {
                const delivered = quantiseDeviceParameterValue({ deviceType, paramId, value: raw });
                expect(
                    delivered,
                    `${identity}: delivered ${delivered} for ${raw}, but ${engine} resolves it to ${setting}`
                ).toBe(setting);
            }

            // The set the control offers is precisely the set of outcomes the
            // engine has. An offered value the engine collapses is a dead
            // position; an outcome the control cannot offer is unreachable.
            const outcomes = [...new Set(resolved.map((entry) => entry.setting))].sort((left, right) => left - right);
            expect(
                [...(descriptor.legalSet?.values ?? [])],
                `${identity}: declared set is not the engine's outcomes`
            ).toEqual(outcomes);
        }
    });

    it('delivers a legal setting for a fractional value, which is what a slew produces', () => {
        // The fixture is integer-only because the engines are: every delivery
        // is rounded before it leaves. This pins the composition order that
        // makes that true — 15.6 rounds to 16 and stays 16, rather than
        // resolving the raw 15.6 down to 8 and changing what an existing
        // automation lane sounds like.
        expect(quantiseDeviceParameterValue({ deviceType: 'crust', paramId: 'oversampling', value: 15.6 })).toBe(16);
        expect(quantiseDeviceParameterValue({ deviceType: 'crust', paramId: 'oversampling', value: 8.6 })).toBe(8);
        expect(quantiseDeviceParameterValue({ deviceType: 'gluten', paramId: 'oversampling', value: 2.6 })).toBe(2);
        // `dutch-oven/algorithm` is `automatable: false`, so this is the
        // MIDI-CC and stale-project route rather than a slew. Rounding still
        // runs first: 3.6 becomes 4, and 4 is reserved, so it lands on Plate
        // rather than on the Spring it was nearest to.
        expect(quantiseDeviceParameterValue({ deviceType: 'dutch-oven', paramId: 'algorithm', value: 3.6 })).toBe(0);
    });
});
