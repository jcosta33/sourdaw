import { beforeEach, describe, expect, it } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../stores/pluginScanStore';
import { findSupportedPlugin } from '../findSupportedPlugin';
import { SUPPORTED_PLUGIN_FORMATS, isSupportedPluginFormat } from '../supportedPluginFormats';

const clapPlugin = {
    id: 'path-hash',
    descriptor_id: 'com.vendor.plugin',
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
                { ...clapPlugin, id: 'legacy-vst', descriptor_id: '', name: 'Legacy VST', format: 'vst3' },
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

    it('resolves every listed supported format and nothing outside the list', () => {
        // Drives the list itself rather than the one format it holds today, so a
        // format added to it is resolvable without this test being rewritten.
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: SUPPORTED_PLUGIN_FORMATS.map((format) => ({
                ...clapPlugin,
                id: `id-${format}`,
                descriptor_id: `com.vendor.${format}`,
                name: `${format} plugin`,
                format,
            })).concat({
                ...clapPlugin,
                id: 'id-unsupported',
                descriptor_id: 'com.vendor.unsupported',
                name: 'unsupported plugin',
                format: 'not-a-format',
            }),
        });

        for (const format of SUPPORTED_PLUGIN_FORMATS) {
            expect(findSupportedPlugin(`id-${format}`)?.format).toBe(format);
        }
        expect(findSupportedPlugin('id-unsupported')).toBeUndefined();
    });

    it('answers the format question case-insensitively on the wire value', () => {
        expect(isSupportedPluginFormat('CLAP')).toBe(true);
        expect(isSupportedPluginFormat('vst3')).toBe(false);
        expect(SUPPORTED_PLUGIN_FORMATS).toContain('clap');
    });
});
