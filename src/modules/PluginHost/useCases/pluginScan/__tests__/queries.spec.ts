import { describe, it, expect, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore } from '../../../stores/pluginScanStore';
import { findPluginByName } from '../queries';

function sample(name: string): ScannedPlugin {
    return {
        id: `id-${name}`,
        name,
        vendor: 'V',
        format: 'VST3',
        category: 'Fx',
        path: '/tmp',
        version: '1',
        descriptor_id: `com.test.${name}`,
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 4,
        has_custom_ui: true,
    };
}

describe('pluginScan queries', () => {
    beforeEach(() => {
        pluginScanStore.set({
            ...defaultPluginScanState,
            scannedPlugins: [sample('FabFilter Pro-Q 3'), sample('Reverb One')],
        });
    });

    it('should find a plugin by exact name ignoring case', () => {
        expect(findPluginByName('fabfilter pro-q 3')?.name).toBe('FabFilter Pro-Q 3');
    });

    it('should fall back to substring match when no exact name matches', () => {
        expect(findPluginByName('Pro-Q')?.name).toBe('FabFilter Pro-Q 3');
    });

    it('should return undefined when no plugin matches', () => {
        expect(findPluginByName('Nonexistent Plugin XYZ')).toBeUndefined();
    });
});
