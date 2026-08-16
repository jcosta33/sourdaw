import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getStableContractFingerprint } from '../../models/GetStableContractFingerprint';
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
});
