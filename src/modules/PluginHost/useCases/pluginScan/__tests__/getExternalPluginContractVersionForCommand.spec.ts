import { afterEach, describe, expect, it } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../stores/pluginScanStore';
import { getExternalPluginContractVersionForCommand } from '../getExternalPluginContractVersionForCommand';

describe('getExternalPluginContractVersionForCommand', () => {
    afterEach(() => {
        pluginScanStore.set(null);
    });

    it('binds the stable plugin identity, declared version, and processing shape', () => {
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                {
                    id: 'path-hash',
                    clap_id: 'com.vendor.plugin',
                    name: 'Vendor Plugin',
                    vendor: 'Vendor',
                    format: 'clap',
                    category: 'effect',
                    path: '/plugins/vendor.clap',
                    version: '1.2.3',
                    num_inputs: 2,
                    num_outputs: 2,
                    num_parameters: 4,
                    has_custom_ui: true,
                },
            ],
        });

        expect(getExternalPluginContractVersionForCommand('com.vendor.plugin')).toBe(
            '["external-plugin-v1","clap","com.vendor.plugin","1.2.3",2,2,4]'
        );
        expect(getExternalPluginContractVersionForCommand('missing-plugin')).toBeUndefined();
    });
});
