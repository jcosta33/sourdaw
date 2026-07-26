import { describe, it, expect, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore, type PluginScanState } from '../pluginScanStore';

function sample(id: string): ScannedPlugin {
    return {
        id,
        name: `Plugin ${id}`,
        vendor: 'Acme',
        format: 'VST3',
        category: 'Fx',
        path: `/plugins/${id}.vst3`,
        version: '1.0',
        clap_id: `com.test.${id}`,
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 8,
        has_custom_ui: false,
    };
}

describe('pluginScanStore', () => {
    beforeEach(() => {
        pluginScanStore.set(defaultPluginScanState);
    });

    it('should default to an empty, idle scan state', () => {
        expect(defaultPluginScanState).toEqual({
            scannedPlugins: [],
            scanPaths: [],
            isScanning: false,
            lastScanTime: null,
            errors: [],
        });
    });

    it('should read back a full scan result written with set', () => {
        const finished: PluginScanState = {
            scannedPlugins: [sample('a'), sample('b')],
            scanPaths: ['/plugins'],
            isScanning: false,
            lastScanTime: 1_700_000_000_000,
            errors: ['Failed to load plugin c'],
        };

        pluginScanStore.set(finished);

        expect(pluginScanStore.value).toEqual(finished);
    });

    it('should apply partial transitions via update without touching other fields', () => {
        pluginScanStore.set({ ...defaultPluginScanState, scanPaths: ['/plugins'] });

        pluginScanStore.update((current) => ({
            ...(current ?? defaultPluginScanState),
            isScanning: true,
        }));

        expect(pluginScanStore.value?.isScanning).toBe(true);
        expect(pluginScanStore.value?.scanPaths).toEqual(['/plugins']);
    });

    it('should notify subscribers with the updated scan state, and stop after unsubscribe', () => {
        const seen: (PluginScanState | null)[] = [];
        const unsubscribe = pluginScanStore.subscribe((value) => {
            seen.push(value);
        });

        pluginScanStore.set({ ...defaultPluginScanState, isScanning: true });
        unsubscribe();
        pluginScanStore.set({ ...defaultPluginScanState, isScanning: false });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.isScanning).toBe(true);
    });

    it('should clear back to null', () => {
        pluginScanStore.set({ ...defaultPluginScanState, isScanning: true });
        pluginScanStore.clear();
        expect(pluginScanStore.value).toBeNull();
    });
});
