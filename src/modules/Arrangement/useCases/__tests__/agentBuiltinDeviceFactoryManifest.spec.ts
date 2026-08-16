import { describe, expect, it } from 'vitest';

import { type PluginDescriptor, BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import {
    applyDescriptorGuidance,
    descriptorGuidance,
    parameterGuidance,
} from '../../models/PluginDescriptors/DescriptorGuidance';
import { getAgentBuiltinDeviceFactoryManifest } from '../getAgentBuiltinDeviceFactoryManifest';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';
import { getFactoryPresets } from '../soundPresetLibrary';

describe('built-in descriptor manifest law', () => {
    it('publishes Arrangement-owned descriptors without inventing runtime topology or latency', () => {
        const manifest = getAgentBuiltinDeviceFactoryManifest();
        expect(manifest).toHaveLength(BUILTIN_PLUGINS.length);
        const sidechain = manifest.find((device) => device.type === 'builtin-sidechain-compressor');
        expect(sidechain).toMatchObject({
            type: 'builtin-sidechain-compressor',
            descriptorVersion: getDeviceContractVersionForCommand('builtin-sidechain-compressor'),
            platform: 'both',
            tail: null,
        });
        expect(sidechain).not.toHaveProperty('ports');
        expect(sidechain).not.toHaveProperty('latency');
    });

    it('publishes exact factory preset identities for a device that has them', () => {
        const eq = getAgentBuiltinDeviceFactoryManifest().find((device) => device.type === 'builtin-eq');
        const expectedIdentities = getFactoryPresets()
            .filter((preset) => preset.devices.some((device) => device.type === 'builtin-eq'))
            .map(({ id, name }) => ({ id, name }));

        expect(expectedIdentities).toContainEqual({ id: 'fx-eq-vocal-presence', name: 'Vocal Presence EQ' });
        expect(eq?.presets).toEqual({
            availability: 'available',
            identities: expectedIdentities,
        });
    });

    it('keeps a device without a factory preset explicitly preset-less', () => {
        const sidechain = getAgentBuiltinDeviceFactoryManifest().find(
            (device) => device.type === 'builtin-sidechain-compressor'
        );

        expect(sidechain).toMatchObject({
            presets: { availability: 'none', identities: [] },
        });
    });

    it('changes the stable preset version when the published preset contract differs', () => {
        const manifest = getAgentBuiltinDeviceFactoryManifest();
        const eq = manifest.find((device) => device.type === 'builtin-eq');
        const sidechain = manifest.find((device) => device.type === 'builtin-sidechain-compressor');

        if (!eq || !sidechain) {
            throw new Error('Expected EQ and sidechain compressor descriptors');
        }
        expect(eq?.presetVersion).toMatch(/^preset-v1:[a-f0-9]{8}$/);
        expect(sidechain?.presetVersion).toMatch(/^preset-v1:[a-f0-9]{8}$/);
        expect(eq?.presetVersion).not.toBe(sidechain?.presetVersion);
        expect(eq.presetVersion).toBe(
            `preset-v1:${getStableContractFingerprint({ availability: eq.presets.availability, identities: eq.presets.identities })}`
        );
        expect(eq.presetVersion).not.toBe(
            `preset-v1:${getStableContractFingerprint({
                availability: eq.presets.availability,
                identities: eq.presets.identities.filter((identity) => identity.id !== 'fx-eq-vocal-presence'),
            })}`
        );
    });

    it('publishes complete owner-authored safety and operating guidance without inferred boilerplate', () => {
        const manifest = getAgentBuiltinDeviceFactoryManifest();
        const eq = manifest.find((device) => device.type === 'builtin-eq');
        const compressor = manifest.find((device) => device.type === 'builtin-compressor');
        const delay = manifest.find((device) => device.type === 'builtin-delay');
        const reverb = manifest.find((device) => device.type === 'builtin-reverb');
        const synth = manifest.find((device) => device.type === 'builtin-synth');

        expect(eq).toMatchObject({
            guidance: {
                usage: 'Shape tonal balance with modest, source-specific band moves.',
                gainCompensation: {
                    availability: 'unavailable',
                    reason: 'EQ has no automatic output compensation; level-match bypass manually.',
                },
            },
        });
        expect(eq?.parameters.find((parameter) => parameter.id === 'eq-low-freq')).toMatchObject({
            guidance: {
                semanticRole: 'Low-band center frequency',
                perceptualRole: 'Selects the bass region that the low band shapes.',
                typicalRange: { minimum: 60, maximum: 180 },
            },
        });
        expect(eq?.parameters.find((parameter) => parameter.id === 'eq-mid-gain')).toMatchObject({
            guidance: {
                semanticRole: 'Mid-band gain',
                perceptualRole: 'Boosts or cuts the selected midrange emphasis.',
                typicalRange: { minimum: -6, maximum: 6 },
            },
        });
        expect(eq?.parameters.find((parameter) => parameter.id === 'eq-high-q')).toMatchObject({
            guidance: {
                semanticRole: 'High-band Q',
                perceptualRole: 'Sets how narrowly the high-band gain is focused.',
                typicalRange: { minimum: 0.5, maximum: 3 },
            },
        });
        expect(compressor).toMatchObject({
            guidance: {
                gainCompensation: {
                    availability: 'provided',
                    parameterId: 'comp-makeup',
                },
            },
        });
        expect(compressor?.parameters.find((parameter) => parameter.id === 'comp-threshold')).toMatchObject({
            guidance: {
                semanticRole: 'Compression threshold',
                typicalRange: { minimum: -30, maximum: -12 },
            },
        });
        expect(compressor?.parameters.find((parameter) => parameter.id === 'comp-ratio')).toMatchObject({
            guidance: {
                semanticRole: 'Compression ratio',
                typicalRange: { minimum: 2, maximum: 6 },
            },
        });
        expect(compressor?.parameters.find((parameter) => parameter.id === 'comp-attack')).toMatchObject({
            guidance: {
                semanticRole: 'Compression attack time',
                typicalRange: { minimum: 5, maximum: 30 },
            },
        });
        expect(compressor?.parameters.find((parameter) => parameter.id === 'comp-release')).toMatchObject({
            guidance: {
                semanticRole: 'Compression release time',
                typicalRange: { minimum: 50, maximum: 250 },
            },
        });
        expect(compressor?.parameters.find((parameter) => parameter.id === 'comp-makeup')).toMatchObject({
            guidance: {
                semanticRole: 'Makeup gain',
                typicalRange: { minimum: 0, maximum: 6 },
            },
        });
        expect(delay?.parameters.find((parameter) => parameter.id === 'delay-time')).toMatchObject({
            guidance: {
                semanticRole: 'Delay time',
                typicalRange: { minimum: 80, maximum: 750 },
            },
        });
        expect(delay?.parameters.find((parameter) => parameter.id === 'delay-feedback')).toMatchObject({
            guidance: {
                semanticRole: 'Delay feedback',
                typicalRange: { minimum: 0.15, maximum: 0.65 },
            },
        });
        expect(reverb?.parameters.find((parameter) => parameter.id === 'rev-mix')).toMatchObject({
            guidance: {
                semanticRole: 'Reverb wet mix',
                typicalRange: { minimum: 0.1, maximum: 0.35 },
            },
        });
        expect(synth?.parameters.find((parameter) => parameter.id === 'attack')).toMatchObject({
            guidance: {
                semanticRole: 'Amplitude-envelope attack time',
                typicalRange: { minimum: 0.005, maximum: 0.1 },
            },
        });
        expect(synth?.parameters.find((parameter) => parameter.id === 'filterCutoff')).toMatchObject({
            guidance: {
                semanticRole: 'Filter cutoff frequency',
                typicalRange: { minimum: 200, maximum: 8000 },
            },
        });

        for (const device of manifest) {
            expect(device.guidance.usage).not.toContain(device.type);
            expect(device.guidance.safety.length).toBeGreaterThan(0);
            expect(device.guidance.interactions.length).toBeGreaterThan(0);
            expect(device.guidance.risks.length).toBeGreaterThan(0);
            expect(['provided', 'unavailable', 'not-applicable']).toContain(
                device.guidance.gainCompensation.availability
            );
            for (const parameter of device.parameters) {
                expect(parameter.guidance.semanticRole).not.toBe('continuous-control');
                expect(parameter.guidance.perceptualRole).not.toBe('audible-parameter');
                expect(parameter.guidance.typicalRange.minimum).toBeGreaterThanOrEqual(parameter.bounds.minimum);
                expect(parameter.guidance.typicalRange.maximum).toBeLessThanOrEqual(parameter.bounds.maximum);
                expect(parameter.guidance.typicalRange).not.toEqual({
                    minimum: parameter.bounds.minimum,
                    maximum: parameter.bounds.maximum,
                });
                expect(['available', 'unavailable', 'not-applicable']).toContain(
                    parameter.guidance.modulation.availability
                );
            }
        }
    });

    it('rejects missing, generic, and unlinked owner guidance mutants', () => {
        const fixture: PluginDescriptor = {
            id: 'guidance-law-fixture',
            name: 'Guidance Law Fixture',
            vendor: 'Arrangement law test',
            format: 'builtin',
            category: 'effect',
            hasCustomUI: false,
            parameters: [
                {
                    id: 'amount',
                    deviceId: 'guidance-law-fixture',
                    name: 'Amount',
                    type: 'float',
                    value: 0.5,
                    minValue: 0,
                    maxValue: 1,
                    defaultValue: 0.5,
                    unit: '',
                    automatable: true,
                    hasAutomation: false,
                },
            ],
        };
        const deviceGuidance = {
            usage: 'Use the fixture only to prove descriptor guidance validation.',
            safety: ['Keep the fixture outside user-facing catalogues.'],
            interactions: ['Its amount control is the complete fixture signal path.'],
            risks: ['A generic declaration would conceal an invalid law fixture.'],
            gainCompensation: {
                availability: 'provided' as const,
                parameterId: 'missing',
                detail: 'Intentional mutant.',
            },
        };

        expect(() => applyDescriptorGuidance([fixture], [])).toThrow('Missing guidance for guidance-law-fixture');
        expect(() =>
            applyDescriptorGuidance(
                [fixture],
                [
                    descriptorGuidance('guidance-law-fixture', deviceGuidance, () =>
                        parameterGuidance(
                            'continuous-control',
                            'audible-parameter',
                            0,
                            1,
                            ['Generic interaction.'],
                            ['Generic risk.'],
                            { availability: 'unavailable', reason: 'Intentional mutant.' }
                        )
                    ),
                ]
            )
        ).toThrow('Generic parameter guidance for guidance-law-fixture/amount');
        expect(() =>
            applyDescriptorGuidance(
                [fixture],
                [
                    descriptorGuidance('guidance-law-fixture', deviceGuidance, () =>
                        parameterGuidance(
                            'Fixture amount',
                            'Sets the fixture amount.',
                            0.25,
                            0.75,
                            ['Use the fixture amount in isolation.'],
                            ['Extreme values are not covered by this fixture.'],
                            { availability: 'unavailable', reason: 'Intentional fixture declaration.' }
                        )
                    ),
                ]
            )
        ).toThrow('Gain compensation references an unknown parameter for guidance-law-fixture: missing');
    });
});
