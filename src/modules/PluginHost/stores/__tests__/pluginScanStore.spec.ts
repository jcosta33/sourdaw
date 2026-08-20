import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { type ScannedPlugin } from '../../models/ScannedPlugin';
import { defaultPluginScanState, pluginScanStore, type PluginScanState } from '../pluginScanStore';

const PLUGIN_SCAN_KEY = 'sourdaw:plugin-scan';

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
            notices: [],
        });
    });

    it('should read back a full scan result written with set', () => {
        const finished: PluginScanState = {
            scannedPlugins: [sample('a'), sample('b')],
            scanPaths: ['/plugins'],
            isScanning: false,
            lastScanTime: 1_700_000_000_000,
            errors: ['Failed to load plugin c'],
            notices: ['VST3 plugins are recognised but not loaded yet.'],
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

    it('should write the scan state through to storage for the next session', () => {
        const finished: PluginScanState = {
            scannedPlugins: [sample('a')],
            scanPaths: ['/plugins'],
            isScanning: false,
            lastScanTime: 1_700_000_000_000,
            errors: [],
            notices: [],
        };

        pluginScanStore.set(finished);

        expect(JSON.parse(window.localStorage.getItem(PLUGIN_SCAN_KEY) ?? 'null')).toEqual(finished);
    });

    it('should keep a scan the quota refused live for the session', () => {
        const first: PluginScanState = {
            scannedPlugins: [sample('a')],
            scanPaths: ['/plugins'],
            isScanning: false,
            lastScanTime: 1_700_000_000_000,
            errors: [],
            notices: [],
        };
        pluginScanStore.set(first);
        const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('exceeded the quota', 'QuotaExceededError');
        });

        const second: PluginScanState = { ...first, scannedPlugins: [sample('a'), sample('b')] };
        pluginScanStore.set(second);
        refuse.mockRestore();

        // The scan succeeded; only its durable copy did not. A throw here would
        // land inside the scan use case, whose error handler writes to this
        // same store and would throw again, stranding `isScanning`.
        expect(pluginScanStore.value).toEqual(second);
    });

    it('should discard the superseded stored scan when the durable write is refused', () => {
        const first: PluginScanState = {
            scannedPlugins: [sample('a')],
            scanPaths: ['/plugins'],
            isScanning: false,
            lastScanTime: 1_700_000_000_000,
            errors: [],
            notices: [],
        };
        pluginScanStore.set(first);
        const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('exceeded the quota', 'QuotaExceededError');
        });

        pluginScanStore.set({ ...first, scannedPlugins: [sample('a'), sample('b')] });
        refuse.mockRestore();

        // Leaving `first` in the key would restore it on the next launch as if
        // it were the current scan, and `getAgentDeviceFactoryManifest` would
        // advertise its parameter contracts as fact. Empty is a state the app
        // already has an answer for; superseded is not.
        expect(window.localStorage.getItem(PLUGIN_SCAN_KEY)).toBeNull();
    });
});

/**
 * A fresh module instance is the next launch: the store is built at import, so
 * what it holds afterwards is exactly what survived the reload.
 */
async function launchWithStoredScanState(stored: string | null): Promise<PluginScanState | null> {
    vi.resetModules();
    if (stored === null) {
        window.localStorage.removeItem(PLUGIN_SCAN_KEY);
    } else {
        window.localStorage.setItem(PLUGIN_SCAN_KEY, stored);
    }
    const nextLaunch = await import('../pluginScanStore');
    return nextLaunch.pluginScanStore.value;
}

describe('pluginScanStore hydration', () => {
    afterEach(() => {
        window.localStorage.removeItem(PLUGIN_SCAN_KEY);
        vi.resetModules();
    });

    it('should restore the previous session scan result, parameter contracts included', async () => {
        const scanned: ScannedPlugin = {
            ...sample('a'),
            parameters: [
                {
                    id: 3,
                    name: 'Cutoff',
                    module: 'Filter',
                    min_value: 0,
                    max_value: 1,
                    default_value: 0.5,
                    is_automatable: true,
                    is_modulatable: false,
                    is_stepped: false,
                    is_enum: false,
                },
            ],
        };

        const restored = await launchWithStoredScanState(
            JSON.stringify({
                scannedPlugins: [scanned],
                scanPaths: ['/plugins'],
                isScanning: false,
                lastScanTime: 1_700_000_000_000,
                errors: [],
            })
        );

        expect(restored?.scannedPlugins).toEqual([scanned]);
        expect(restored?.scanPaths).toEqual(['/plugins']);
        expect(restored?.lastScanTime).toBe(1_700_000_000_000);
    });

    it('should not restore a scan that was still running when the session ended', async () => {
        const restored = await launchWithStoredScanState(
            JSON.stringify({
                scannedPlugins: [sample('a')],
                scanPaths: [],
                isScanning: true,
                lastScanTime: null,
                errors: ['Failed to load plugin c'],
                notices: ['VST3 plugins are recognised but not loaded yet.'],
            })
        );

        // A scan the process did not survive is not in flight, and the use
        // cases' in-flight guard would refuse to start a real one over it.
        expect(restored?.isScanning).toBe(false);
        expect(restored?.errors).toEqual([]);
        // Notices go the same way as errors and for the same reason: they
        // describe the run that is gone. Restoring them would show the user a
        // reason about a scan that never produced it this session, and the next
        // scan restates whichever ones still apply.
        expect(restored?.notices).toEqual([]);
    });

    it('should drop a stored plugin that is missing part of its scanned contract', async () => {
        const { has_custom_ui: _omitted, ...incomplete } = sample('a');

        const restored = await launchWithStoredScanState(
            JSON.stringify({
                scannedPlugins: [incomplete, sample('b')],
                scanPaths: [],
                isScanning: false,
                lastScanTime: null,
                errors: [],
            })
        );

        expect(restored?.scannedPlugins).toEqual([sample('b')]);
    });

    it('should restore the reason a plugin capability is a default rather than a measurement', async () => {
        // Zeros that survive a reload without their reason are read downstream
        // as a scanned fact about the plugin. The reason is what makes an
        // unqueried default legible as one, so it has to survive with them.
        const unqueried: ScannedPlugin = {
            ...sample('a'),
            num_inputs: 0,
            num_outputs: 0,
            has_custom_ui: false,
            capability_metadata_reason: 'This plugin does not implement clap.audio-ports.',
        };

        const restored = await launchWithStoredScanState(
            JSON.stringify({
                scannedPlugins: [unqueried],
                scanPaths: [],
                isScanning: false,
                lastScanTime: null,
                errors: [],
            })
        );

        expect(restored?.scannedPlugins).toEqual([unqueried]);
    });

    it('should start empty when the stored value cannot be read', async () => {
        const restored = await launchWithStoredScanState('{not json at all');

        expect(restored).toEqual(defaultPluginScanState);
    });
});
