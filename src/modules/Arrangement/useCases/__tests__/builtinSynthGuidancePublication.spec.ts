import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getAgentBuiltinDeviceFactoryManifest } from '../getAgentBuiltinDeviceFactoryManifest';

const SYNTH_FAMILY_IDS = [
    'builtin-synth',
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
] as const;

type SynthFamilyId = (typeof SYNTH_FAMILY_IDS)[number];

type NumericContract = {
    bounds: { minimum: number; maximum: number };
    default: number;
};

const BASE_NUMERIC_CONTRACTS: Readonly<Record<string, NumericContract>> = {
    waveform: { bounds: { minimum: 0, maximum: 3 }, default: 2 },
    attack: { bounds: { minimum: 0.001, maximum: 2 }, default: 0.01 },
    decay: { bounds: { minimum: 0.001, maximum: 2 }, default: 0.2 },
    sustain: { bounds: { minimum: 0, maximum: 1 }, default: 0.7 },
    release: { bounds: { minimum: 0.001, maximum: 5 }, default: 0.3 },
    filterCutoff: { bounds: { minimum: 20, maximum: 20000 }, default: 5000 },
    filterResonance: { bounds: { minimum: 0, maximum: 20 }, default: 1 },
    filterType: { bounds: { minimum: 0, maximum: 2 }, default: 0 },
    filterEnvAmount: { bounds: { minimum: 0, maximum: 10000 }, default: 0 },
    detune: { bounds: { minimum: -100, maximum: 100 }, default: 0 },
    gain: { bounds: { minimum: 0, maximum: 1 }, default: 0.3 },
    osc2Waveform: { bounds: { minimum: 0, maximum: 3 }, default: 2 },
    osc2Detune: { bounds: { minimum: -1200, maximum: 1200 }, default: 0 },
    osc2Mix: { bounds: { minimum: 0, maximum: 1 }, default: 0 },
    subOscLevel: { bounds: { minimum: 0, maximum: 1 }, default: 0 },
    noiseLevel: { bounds: { minimum: 0, maximum: 1 }, default: 0 },
    vibratoRate: { bounds: { minimum: 0, maximum: 10 }, default: 0 },
    vibratoDepth: { bounds: { minimum: 0, maximum: 50 }, default: 0 },
    stereoSpread: { bounds: { minimum: 0, maximum: 1 }, default: 0 },
    vibratoDelay: { bounds: { minimum: 0, maximum: 2 }, default: 0.3 },
    filterVelocitySensitivity: { bounds: { minimum: 0, maximum: 1 }, default: 0 },
};

const DEFAULT_OVERRIDES: Readonly<Record<SynthFamilyId, Readonly<Record<string, number>>>> = {
    'builtin-synth': {},
    'builtin-synth-mellotron': {
        waveform: 3,
        attack: 0.1,
        decay: 0.4,
        release: 0.3,
        filterCutoff: 2500,
        vibratoRate: 5.5,
        vibratoDepth: 20,
        noiseLevel: 0.05,
    },
    'builtin-synth-strings': {
        waveform: 2,
        attack: 0.3,
        release: 1.2,
        osc2Mix: 0.5,
        osc2Detune: 15,
        stereoSpread: 1,
    },
    'builtin-synth-808bass': {
        waveform: 0,
        attack: 0.01,
        decay: 1.2,
        sustain: 0,
        subOscLevel: 1,
        filterCutoff: 800,
        filterEnvAmount: 1200,
    },
    'builtin-synth-brass': {
        waveform: 2,
        attack: 0.05,
        filterEnvAmount: 3000,
        osc2Waveform: 3,
        osc2Mix: 0.3,
        filterCutoff: 500,
        filterResonance: 3,
        stereoSpread: 0.5,
    },
};

function expectedNumericContracts(deviceId: SynthFamilyId): Readonly<Record<string, NumericContract>> {
    const overrides = DEFAULT_OVERRIDES[deviceId];
    return Object.fromEntries(
        Object.entries(BASE_NUMERIC_CONTRACTS).map(([parameterId, contract]) => [
            parameterId,
            { ...contract, default: overrides[parameterId] ?? contract.default },
        ])
    );
}

describe('builtin synth guidance publication', () => {
    it('publishes the owner guidance and preserves every base and variant numeric contract', () => {
        const descriptorsById = new Map(BUILTIN_PLUGINS.map((descriptor) => [descriptor.id, descriptor]));
        const manifestById = new Map(
            getAgentBuiltinDeviceFactoryManifest().map((descriptor) => [descriptor.type, descriptor])
        );

        for (const deviceId of SYNTH_FAMILY_IDS) {
            const owner = descriptorsById.get(deviceId);
            const published = manifestById.get(deviceId);
            if (!owner?.guidance || !published) {
                throw new Error(`Missing synth-family owner or manifest descriptor: ${deviceId}`);
            }

            const expectedContracts = expectedNumericContracts(deviceId);
            expect(
                Object.fromEntries(
                    owner.parameters.map((parameter) => [
                        parameter.id,
                        {
                            bounds: { minimum: parameter.minValue, maximum: parameter.maxValue },
                            default: parameter.defaultValue,
                        },
                    ])
                )
            ).toEqual(expectedContracts);
            expect(owner.parameters.every((parameter) => parameter.value === parameter.defaultValue)).toBe(true);

            expect(
                Object.fromEntries(
                    published.parameters.map((parameter) => [
                        parameter.id,
                        { bounds: parameter.bounds, default: parameter.default },
                    ])
                )
            ).toEqual(expectedContracts);
            expect(
                Object.fromEntries(published.parameters.map((parameter) => [parameter.id, parameter.guidance]))
            ).toEqual(owner.guidance.parameters);
        }
    });

    it('publishes velocity-scaled attack timing for delayed vibrato', () => {
        const published = getAgentBuiltinDeviceFactoryManifest().find(
            (descriptor) => descriptor.type === 'builtin-synth'
        );
        const parameters = new Map(published?.parameters.map((parameter) => [parameter.id, parameter.guidance]));

        expect(parameters.get('vibratoDelay')?.interactions).toContain(
            'Vibrato stays at zero through the velocity-scaled amplitude attack and vibratoDelay, then reaches full depth over a 100 ms ramp; vibratoRate and vibratoDepth must both be active.'
        );
        expect(parameters.get('vibratoDepth')?.interactions).toContain(
            'vibratoDepth requires vibratoRate above zero and reaches full depth after the velocity-scaled amplitude attack, vibratoDelay, and a 100 ms ramp.'
        );
    });

    it('publishes the highpass and bandpass cutoff risk with the correct frequency direction', () => {
        const published = getAgentBuiltinDeviceFactoryManifest().find(
            (descriptor) => descriptor.type === 'builtin-synth'
        );
        const cutoffGuidance = published?.parameters.find((parameter) => parameter.id === 'filterCutoff')?.guidance;

        expect(cutoffGuidance?.risks).toContain(
            "A highpass filter attenuates frequencies below the cutoff, so raising filterCutoff can remove low-frequency body; a bandpass filter attenuates frequencies outside the band around the cutoff, so moving filterCutoff away from a note's strongest partials can thin or silence it."
        );
    });
});
