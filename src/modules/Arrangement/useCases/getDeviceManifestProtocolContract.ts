import { BUILTIN_PLUGINS, isDeviceSupportedOnCurrentPlatform } from '../models/DeviceParameter';

import { getDeviceContractVersionForCommand } from './getDeviceContractVersionForCommand';

export const DEVICE_MANIFEST_SCHEMA_VERSION = 1 as const;

export function getDeviceManifestProtocolContract() {
    return {
        id: 'device-manifest' as const,
        owner: 'Arrangement' as const,
        schemaVersion: DEVICE_MANIFEST_SCHEMA_VERSION,
        capabilities: [
            'parameter-descriptors',
            'platform-availability',
            'state-chunks',
            'contract-fingerprints',
        ] as const,
        operations: BUILTIN_PLUGINS.map((descriptor) => ({
            name: descriptor.id,
            version: getDeviceContractVersionForCommand(descriptor.id) ?? 'descriptor-v1:unavailable',
            availability: isDeviceSupportedOnCurrentPlatform(descriptor.id)
                ? ('available' as const)
                : ('unavailable-on-platform' as const),
        })),
        availability: 'available' as const,
        compatibility: {
            mode: 'read-only-preserve' as const,
            behavior:
                'Preserve opaque device state and expose unavailable descriptors without replaying their creation command.',
            canonicalProjectRequiresCommandReplay: false as const,
        },
    };
}
