import { afterEach, describe, expect, it } from 'vitest';

import { commandDeviceVersionsPort } from '#/modules/Command/useCases';

import { getPluginById } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { getBuiltinPlugins } from '../getBuiltinPlugins';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';
import { getDeviceTypesForCommandDeviceIds } from '../getDeviceTypesForCommandDeviceIds';

// PR #4476 adds owner guidance to these existing synth-family descriptors. Guidance is
// intentionally part of the command contract fingerprint so stale approvals refresh
// instead of replaying against older planner-facing semantics.
const SYNTH_FAMILY_GUIDANCE_VERSION_BUMPS: Readonly<Record<string, string>> = {
    'builtin-synth': 'descriptor-v1:4a83d904',
    'builtin-synth-mellotron': 'descriptor-v1:f9e1a882',
    'builtin-synth-strings': 'descriptor-v1:62519c0a',
    'builtin-synth-808bass': 'descriptor-v1:d8ad3517',
    'builtin-synth-brass': 'descriptor-v1:e0b5d9cb',
};

const BASELINE_DESCRIPTOR_VERSION_PINS: Readonly<Record<string, string>> = {
    'builtin-eq': 'descriptor-v1:63102173',
    'builtin-compressor': 'descriptor-v1:432b6464',
    'builtin-reverb': 'descriptor-v1:17ea53ba',
    'builtin-delay': 'descriptor-v1:1eecdfbd',
    'builtin-gain': 'descriptor-v1:90d45036',
    'builtin-sidechain-compressor': 'descriptor-v1:48c2eed9',
    'builtin-chorus': 'descriptor-v1:36195797',
    'builtin-phaser': 'descriptor-v1:c07911d0',
    'builtin-distortion': 'descriptor-v1:abecffde',
    'builtin-limiter': 'descriptor-v1:caf1f542',
    'builtin-flanger': 'descriptor-v1:6fa90097',
    'builtin-tremolo': 'descriptor-v1:cfbd51d9',
    'builtin-bitcrusher': 'descriptor-v1:462ac96a',
    'builtin-filter': 'descriptor-v1:1b87356b',
    'builtin-autopan': 'descriptor-v1:f01a4a0f',
    'builtin-convolution-reverb': 'descriptor-v1:5b9a4630',
    'builtin-stereo-widener': 'descriptor-v1:af373b3b',
    'builtin-deesser': 'descriptor-v1:07639674',
    'builtin-lufs-meter': 'descriptor-v1:76e76f72',
    'builtin-synth': 'descriptor-v1:614f201f',
    'builtin-drum-kit': 'descriptor-v1:15e97237',
    'dutch-oven': 'descriptor-v1:697d31a3',
    'native-scoring': 'descriptor-v1:6236c1eb',
    'faust-zita-rev1-reverb': 'descriptor-v1:8fe5016c',
    'faust-1176-compressor': 'descriptor-v1:5b2d5282',
    'faust-multiband-compressor': 'descriptor-v1:f7e38327',
    'faust-pro-parametric-eq': 'descriptor-v1:660c3122',
    'faust-tape-delay': 'descriptor-v1:8a578bc0',
    'faust-brick-wall-limiter': 'descriptor-v1:feea1aba',
    'faust-spring-reverb': 'descriptor-v1:c22c48df',
    'faust-noise-gate': 'descriptor-v1:bbab4ffb',
    'faust-gain-utility': 'descriptor-v1:ddd04de5',
    'faust-lufs-meter': 'descriptor-v1:ba1eba2e',
    'faust-stereo-widener': 'descriptor-v1:369c6f01',
    'faust-de-esser': 'descriptor-v1:01925fec',
    'faust-rhodes': 'descriptor-v1:8bdddff9',
    'faust-fm-synth': 'descriptor-v1:884cb08a',
    'faust-supersaw-unison': 'descriptor-v1:cb811bb7',
    'builtin-synth-mellotron': 'descriptor-v1:71cf9d31',
    'builtin-synth-strings': 'descriptor-v1:11f074db',
    'builtin-synth-808bass': 'descriptor-v1:274a35d6',
    'builtin-synth-brass': 'descriptor-v1:5dbc0228',
    'builtin-drum-machine-808': 'descriptor-v1:3157334a',
    'builtin-drum-machine-analog': 'descriptor-v1:b497a2ee',
    'builtin-drum-machine-electronic': 'descriptor-v1:c681efac',
    'builtin-drum-machine-acoustic': 'descriptor-v1:8ac879ad',
    fermenter: 'descriptor-v1:42afff88',
    toaster: 'descriptor-v1:ef8943ce',
    levain: 'descriptor-v1:7b9657aa',
    gluten: 'descriptor-v1:868d9641',
    bacteria: 'descriptor-v1:14838614',
    grinder: 'descriptor-v1:fe7c1d7a',
    proof: 'descriptor-v1:0f484ceb',
    yeast: 'descriptor-v1:e58d800b',
    crust: 'descriptor-v1:ec64c4e8',
    'builtin-crumbs': 'descriptor-v1:b99d022e',
    'grand-boule': 'descriptor-v1:93d1562a',
    knead: 'descriptor-v1:f8e350da',
};

describe('getDeviceContractVersionForCommand', () => {
    afterEach(() => {
        trackStore.set(null);
        commandDeviceVersionsPort.setDeviceTypeResolver(null);
        commandDeviceVersionsPort.setResolver(null);
    });

    it('derives a stable semantic version from the live built-in descriptor', () => {
        const first = getDeviceContractVersionForCommand('builtin-compressor');
        const second = getDeviceContractVersionForCommand('builtin-compressor');

        expect(first).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
        expect(second).toBe(first);
        expect(getDeviceContractVersionForCommand('missing-device')).toBeUndefined();
    });

    it('captures a version when a command device-id sweep names a faust instrument', () => {
        // The production wiring bootstrap installs: the Arrangement device-type
        // resolver plus this module's descriptor resolver. A template or preset
        // chain holds faust-rhodes devices, so a setDeviceParameter command
        // whose arguments name one must capture its contract version rather
        // than throw "Device version is unavailable".
        const track = createTrack({
            id: 'track-keys',
            initialAlternativeId: 'alternative-keys',
            kind: 'midi',
            name: 'Keys',
        });
        track.devices = [
            {
                bypassed: false,
                id: 'device-rhodes',
                name: 'Warm Rhodes',
                parameterValues: {},
                type: 'faust-rhodes',
            },
        ];
        trackStore.set({ selectedTrackId: null, tracks: [track] });
        commandDeviceVersionsPort.setDeviceTypeResolver(getDeviceTypesForCommandDeviceIds);
        commandDeviceVersionsPort.setResolver(getDeviceContractVersionForCommand);

        expect(
            commandDeviceVersionsPort.capture({
                argumentsValue: { deviceId: 'device-rhodes', paramId: 'brightness', value: 0.3 },
                operation: 'setDeviceParameter',
            })
        ).toEqual({ 'faust-rhodes': expect.stringMatching(/^descriptor-v1:[0-9a-f]{8}$/) });
    });

    it('resolves the faust instrument types shipped by presets and templates', () => {
        for (const deviceType of ['faust-rhodes', 'faust-fm-synth', 'faust-supersaw-unison']) {
            const descriptor = getPluginById(deviceType);
            if (!descriptor) {
                throw new Error(`Expected a plugin descriptor for ${deviceType}`);
            }
            expect(getDeviceContractVersionForCommand(deviceType)).toBe(
                `descriptor-v1:${getStableContractFingerprint(descriptor)}`
            );
            expect(getDeviceContractVersionForCommand(deviceType)).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
        }
    });

    it('pins the full descriptor registry and limits intentional version changes to synth-family guidance', () => {
        const descriptorIds = [...new Set(getBuiltinPlugins().map((plugin) => plugin.id))].sort();
        expect(Object.keys(BASELINE_DESCRIPTOR_VERSION_PINS).sort()).toEqual(descriptorIds);

        const changedFromBaseline = descriptorIds.filter(
            (deviceType) =>
                getDeviceContractVersionForCommand(deviceType) !== BASELINE_DESCRIPTOR_VERSION_PINS[deviceType]
        );
        expect(changedFromBaseline).toEqual(Object.keys(SYNTH_FAMILY_GUIDANCE_VERSION_BUMPS).sort());

        for (const deviceType of descriptorIds) {
            const expectedVersion =
                SYNTH_FAMILY_GUIDANCE_VERSION_BUMPS[deviceType] ?? BASELINE_DESCRIPTOR_VERSION_PINS[deviceType];
            expect(getDeviceContractVersionForCommand(deviceType), deviceType).toBe(expectedVersion);
        }
    });

    it('records synth-family guidance as the intentional descriptor-version bump', () => {
        for (const [deviceType, current] of Object.entries(SYNTH_FAMILY_GUIDANCE_VERSION_BUMPS)) {
            const descriptor = getPluginById(deviceType);
            if (!descriptor?.guidance) {
                throw new Error(`Expected synth-family guidance in the authoritative descriptor for ${deviceType}`);
            }

            const beforeGuidance = BASELINE_DESCRIPTOR_VERSION_PINS[deviceType];
            expect(beforeGuidance, deviceType).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
            expect(current, deviceType).toBe(`descriptor-v1:${getStableContractFingerprint(descriptor)}`);
            expect(getDeviceContractVersionForCommand(deviceType), deviceType).toBe(current);
            expect(current, deviceType).not.toBe(beforeGuidance);
        }
    });

    it('versions the canonical Knead device without inventing device-owned parameters', () => {
        const descriptor = getPluginById('knead');

        expect(descriptor).toMatchObject({
            id: 'knead',
            name: 'Knead',
            format: 'builtin',
            category: 'effect',
            hasCustomUI: false,
            platform: 'both',
            parameters: [],
        });
        expect(getDeviceContractVersionForCommand('knead')).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
    });

    it('keeps command replay stable when only descriptor character tags change', () => {
        const descriptor = getPluginById('builtin-distortion');
        if (!descriptor) {
            throw new Error('Expected the distortion descriptor');
        }
        const originalCharacterTags = descriptor.characterTags;
        const before = getDeviceContractVersionForCommand(descriptor.id);

        try {
            descriptor.characterTags = ['tube'];

            expect(getDeviceContractVersionForCommand(descriptor.id)).toBe(before);
        } finally {
            descriptor.characterTags = originalCharacterTags;
        }
    });

    it('includes Arrangement-owned guidance in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.guidance) {
            throw new Error('Expected compressor guidance in the authoritative descriptor');
        }

        const originalGuidance = descriptor.guidance;
        const before = getDeviceContractVersionForCommand(descriptor.id);

        try {
            descriptor.guidance = {
                ...descriptor.guidance,
                usage: 'Mutant guidance that must change the descriptor contract.',
            };

            expect(getDeviceContractVersionForCommand(descriptor.id)).not.toBe(before);
        } finally {
            descriptor.guidance = originalGuidance;
        }
    });

    it('includes Arrangement-owned domain capability identity in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.capabilities) {
            throw new Error('Expected compressor domain capabilities in the authoritative descriptor');
        }

        const originalCapabilities = descriptor.capabilities;
        const before = getDeviceContractVersionForCommand(descriptor.id);

        try {
            descriptor.capabilities = {
                ...descriptor.capabilities,
                audioProcessing: {
                    availability: 'unavailable' as const,
                    reason: 'Mutant capability that must change the descriptor contract.',
                },
            };

            expect(getDeviceContractVersionForCommand(descriptor.id)).not.toBe(before);
        } finally {
            descriptor.capabilities = originalCapabilities;
        }
    });

    it('includes Arrangement-owned parameter identity in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        const firstParameter = descriptor?.parameters[0];
        if (!descriptor || !firstParameter) {
            throw new Error('Expected a compressor parameter in the authoritative descriptor');
        }
        const originalParameters = descriptor.parameters;
        const before = getDeviceContractVersionForCommand(descriptor.id);

        try {
            descriptor.parameters = [
                { ...firstParameter, defaultValue: firstParameter.defaultValue + 1 },
                ...descriptor.parameters.slice(1),
            ];

            expect(getDeviceContractVersionForCommand(descriptor.id)).not.toBe(before);
        } finally {
            descriptor.parameters = originalParameters;
        }
    });
});
