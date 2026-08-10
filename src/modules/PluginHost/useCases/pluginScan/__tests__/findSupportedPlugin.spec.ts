import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../stores/pluginScanStore';
import { findSupportedPlugin } from '../findSupportedPlugin';

const clapPlugin = {
    id: 'path-hash',
    clap_id: 'com.vendor.plugin',
    name: 'Vendor Plugin',
    vendor: 'Vendor',
    format: 'clap',
    category: 'effect',
    path: '/plugins/vendor.clap',
    version: '1.0.0',
    num_inputs: 2,
    num_outputs: 2,
    num_parameters: 4,
    has_custom_ui: true,
};

describe('findSupportedPlugin', () => {
    beforeEach(() => {
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [
                clapPlugin,
                { ...clapPlugin, id: 'legacy-vst', clap_id: '', name: 'Legacy VST', format: 'vst3' },
            ],
        });
    });

    it('resolves a CLAP plugin by path id, descriptor id, or exact name', () => {
        expect(findSupportedPlugin('path-hash')).toEqual(clapPlugin);
        expect(findSupportedPlugin('com.vendor.plugin')).toEqual(clapPlugin);
        expect(findSupportedPlugin('vendor plugin')).toEqual(clapPlugin);
    });

    it('rejects unsupported formats and partial names', () => {
        expect(findSupportedPlugin('legacy-vst')).toBeUndefined();
        expect(findSupportedPlugin('Vendor')).toBeUndefined();
        expect(findSupportedPlugin('')).toBeUndefined();
    });
});
