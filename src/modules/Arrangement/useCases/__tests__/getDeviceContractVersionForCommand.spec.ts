import { afterEach, describe, expect, it } from 'vitest';

import { commandDeviceVersionsPort } from '#/modules/Command/useCases';

import { getPluginById } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';
import { getDeviceTypesForCommandDeviceIds } from '../getDeviceTypesForCommandDeviceIds';

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
        // were added: an unrelated builtin, the faust effect family, and the
        // canonical device. The fingerprint covers the whole descriptor, so a
        // shifted pin means an existing entry was mutated, not merely appended
        // beside.
        expect(getDeviceContractVersionForCommand('builtin-compressor')).toBe('descriptor-v1:6d4efc97');
        expect(getDeviceContractVersionForCommand('faust-zita-rev1-reverb')).toBe('descriptor-v1:a1b8ac4e');
        expect(getDeviceContractVersionForCommand('knead')).toBe('descriptor-v1:f8e350da');
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
