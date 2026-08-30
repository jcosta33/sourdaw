import { afterEach, describe, expect, it } from 'vitest';

import { commandDeviceVersionsPort } from '#/modules/Command/useCases';

import { getPluginById } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { getBuiltinPlugins } from '../getBuiltinPlugins';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';
import { getDeviceTypesForCommandDeviceIds } from '../getDeviceTypesForCommandDeviceIds';

// The descriptor ids the faust instrument additions append to the registry;
// every other id pre-exists them and is version-pinned below.
const FAUST_INSTRUMENT_DESCRIPTOR_IDS: ReadonlySet<string> = new Set([
    'faust-rhodes',
    'faust-fm-synth',
    'faust-supersaw-unison',
]);

const PRE_EXISTING_VERSION_PINS: Readonly<Record<string, string>> = {
    'builtin-eq': 'descriptor-v1:81231c16',
    'builtin-compressor': 'descriptor-v1:6d4efc97',
    'builtin-reverb': 'descriptor-v1:6aeebcb2',
    'builtin-delay': 'descriptor-v1:dad2288d',
    'builtin-gain': 'descriptor-v1:b921b6d4',
    'builtin-sidechain-compressor': 'descriptor-v1:b3aa42b3',
    'builtin-chorus': 'descriptor-v1:bb16a9e6',
    'builtin-phaser': 'descriptor-v1:26f7b5f9',
    'builtin-distortion': 'descriptor-v1:6d4f67e2',
    'builtin-limiter': 'descriptor-v1:1118e789',
    'builtin-flanger': 'descriptor-v1:f88bf407',
    'builtin-tremolo': 'descriptor-v1:6220cff0',
    'builtin-bitcrusher': 'descriptor-v1:d6538137',
    'builtin-filter': 'descriptor-v1:058b3c23',
    'builtin-autopan': 'descriptor-v1:fc49f0ef',
    'builtin-convolution-reverb': 'descriptor-v1:8e3bd343',
    'builtin-stereo-widener': 'descriptor-v1:18c2af2b',
    'builtin-deesser': 'descriptor-v1:01ddd0bd',
    'builtin-lufs-meter': 'descriptor-v1:dde594a9',
    'builtin-synth': 'descriptor-v1:614f201f',
    'builtin-drum-kit': 'descriptor-v1:15e97237',
    'dutch-oven': 'descriptor-v1:91f87aa6',
    'native-scoring': 'descriptor-v1:69e1beae',
    'faust-zita-rev1-reverb': 'descriptor-v1:a1b8ac4e',
    'faust-1176-compressor': 'descriptor-v1:50ed7429',
    'faust-multiband-compressor': 'descriptor-v1:d66aa94e',
    'faust-pro-parametric-eq': 'descriptor-v1:6640c449',
    'faust-tape-delay': 'descriptor-v1:669d2454',
    'faust-brick-wall-limiter': 'descriptor-v1:244ffb5f',
    'faust-spring-reverb': 'descriptor-v1:da14822b',
    'faust-noise-gate': 'descriptor-v1:be68ac86',
    'faust-gain-utility': 'descriptor-v1:d829fe47',
    'faust-lufs-meter': 'descriptor-v1:ba1eba2e',
    'faust-stereo-widener': 'descriptor-v1:791ba3b2',
    'faust-de-esser': 'descriptor-v1:6a99ca81',
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
    bacteria: 'descriptor-v1:2abc1121',
    grinder: 'descriptor-v1:fe7c1d7a',
    proof: 'descriptor-v1:db946290',
    yeast: 'descriptor-v1:de4ebeb7',
    crust: 'descriptor-v1:452855be',
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

    it('leaves every pre-existing descriptor version unchanged by the faust instrument additions', () => {
        // Pinned against the registry before the faust instrument descriptors
        // were added: every descriptor id the registry already held, not a
        // three-device sample of it. The fingerprint covers the whole
        // descriptor, so a shifted pin means an existing entry was mutated,
        // not merely appended beside. The key set is checked against the live
        // registry too, so a wrong pin, a dropped pin, or a device added
        // later without pinning its version all fail here by name.
        const preExistingIds = [
            ...new Set(
                getBuiltinPlugins()
                    .map((plugin) => plugin.id)
                    .filter((id) => !FAUST_INSTRUMENT_DESCRIPTOR_IDS.has(id))
            ),
        ].sort();
        expect(Object.keys(PRE_EXISTING_VERSION_PINS).sort()).toEqual(preExistingIds);

        for (const [deviceType, pinnedVersion] of Object.entries(PRE_EXISTING_VERSION_PINS)) {
            expect(getDeviceContractVersionForCommand(deviceType), deviceType).toBe(pinnedVersion);
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

    it('includes Arrangement-owned guidance in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.guidance) {
            throw new Error('Expected compressor guidance in the authoritative descriptor');
        }

        const mutatedGuidance = {
            ...descriptor,
            guidance: {
                ...descriptor.guidance,
                usage: 'Mutant guidance that must change the descriptor contract.',
            },
        };

        expect(getDeviceContractVersionForCommand('builtin-compressor')).toBe(
            `descriptor-v1:${getStableContractFingerprint(descriptor)}`
        );
        expect(getDeviceContractVersionForCommand('builtin-compressor')).not.toBe(
            `descriptor-v1:${getStableContractFingerprint(mutatedGuidance)}`
        );
    });

    it('includes Arrangement-owned domain capability identity in the descriptor fingerprint', () => {
        const descriptor = getPluginById('builtin-compressor');
        if (!descriptor?.capabilities) {
            throw new Error('Expected compressor domain capabilities in the authoritative descriptor');
        }

        const mutatedCapabilities = {
            ...descriptor,
            capabilities: {
                ...descriptor.capabilities,
                audioProcessing: {
                    availability: 'unavailable' as const,
                    reason: 'Mutant capability that must change the descriptor contract.',
                },
            },
        };

        expect(getDeviceContractVersionForCommand('builtin-compressor')).toBe(
            `descriptor-v1:${getStableContractFingerprint(descriptor)}`
        );
        expect(getDeviceContractVersionForCommand('builtin-compressor')).not.toBe(
            `descriptor-v1:${getStableContractFingerprint(mutatedCapabilities)}`
        );
    });
});
