import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getAgentBuiltinDeviceFactoryManifest } from '../getAgentBuiltinDeviceFactoryManifest';
import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';

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
});
