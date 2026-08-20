import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../../models/ScannedPlugin';
import { type ScanResult } from '../../../../repositories/pluginBridge/types';
import { type PluginScanState } from '../../../../stores/pluginScanStore';
import { scanCustomPaths } from '../scanCustomPaths';

function create_scanned_plugin(overrides: Partial<ScannedPlugin> = {}): ScannedPlugin {
    return {
        id: 'plugin-id',
        name: 'Plugin',
        vendor: 'Vendor',
        format: 'vst3',
        category: 'instrument',
        path: '/plugins/plugin.vst3',
        version: '1.0.0',
        descriptor_id: 'com.test.plugin',
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 8,
        has_custom_ui: false,
        ...overrides,
    };
}

function create_plugin_scan_state(overrides: Partial<PluginScanState> = {}): PluginScanState {
    return {
        scanPaths: [],
        isScanning: false,
        scannedPlugins: [],
        errors: [],
        notices: [],
        lastScanTime: null,
        ...overrides,
    };
}

function create_deferred<ResultValue>() {
    let resolve_promise = (_value: ResultValue): void => {};
    const promise = new Promise<ResultValue>((resolve) => {
        resolve_promise = resolve;
    });

    return { promise, resolve: resolve_promise };
}

const mocks = vi.hoisted(() => {
    const pluginScanStoreValue: { value: PluginScanState } = {
        value: {
            scanPaths: [],
            isScanning: false,
            scannedPlugins: [],
            errors: [],
            notices: [],
            lastScanTime: null,
        },
    };
    return {
        pluginScanStoreValue,
        pluginScanStoreSet: vi.fn<typeof import('../../../../stores/pluginScanStore').pluginScanStore.set>(),
        pluginScanStoreUpdate: vi.fn<typeof import('../../../../stores/pluginScanStore').pluginScanStore.update>(),
        scanPlugins: vi.fn<typeof import('../../../../repositories/pluginBridge/scanPlugins').scanPlugins>(),
    };
});

vi.mock('../../../../stores/pluginScanStore', () => ({
    pluginScanStore: {
        get value() {
            return mocks.pluginScanStoreValue.value;
        },
        set: mocks.pluginScanStoreSet,
        update: mocks.pluginScanStoreUpdate,
    },
    defaultPluginScanState: {},
}));

vi.mock('../../../../repositories/pluginBridge/scanPlugins', () => ({
    scanPlugins: mocks.scanPlugins,
}));

describe('scanCustomPaths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pluginScanStoreValue.value = create_plugin_scan_state();
        mocks.pluginScanStoreSet.mockImplementation((value) => {
            if (value !== null) {
                mocks.pluginScanStoreValue.value = value;
            }
        });
        mocks.pluginScanStoreUpdate.mockImplementation((updater) => {
            const next_value = updater(mocks.pluginScanStoreValue.value);
            mocks.pluginScanStoreSet(next_value);
        });
    });

    it('appends only plugins not already scanned', async () => {
        mocks.pluginScanStoreValue.value.scannedPlugins = [create_scanned_plugin({ id: 'existing' })];
        const scanned = [create_scanned_plugin({ id: 'existing' }), create_scanned_plugin({ id: 'fresh' })];
        mocks.scanPlugins.mockResolvedValue({ plugins: scanned, errors: [], notices: [], scan_duration_ms: 0 });

        await scanCustomPaths(['/custom']);

        expect(mocks.scanPlugins).toHaveBeenCalledWith(['/custom']);
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                scannedPlugins: [create_scanned_plugin({ id: 'existing' }), create_scanned_plugin({ id: 'fresh' })],
            })
        );
    });

    it('should not clobber plugin-list edits made while scanPlugins is awaiting', async () => {
        mocks.pluginScanStoreValue.value.scannedPlugins = [create_scanned_plugin({ id: 'existing' })];
        const scan_deferred = create_deferred<ScanResult>();
        mocks.scanPlugins.mockReturnValue(scan_deferred.promise);

        const scan_promise = scanCustomPaths(['/custom']);
        await Promise.resolve();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(['/custom']);

        mocks.pluginScanStoreValue.value = {
            ...mocks.pluginScanStoreValue.value,
            scannedPlugins: [create_scanned_plugin({ id: 'existing' }), create_scanned_plugin({ id: 'manual-edit' })],
        };
        scan_deferred.resolve({
            plugins: [create_scanned_plugin({ id: 'fresh' })],
            errors: [],
            notices: [],
            scan_duration_ms: 0,
        });
        await scan_promise;

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                scannedPlugins: [
                    create_scanned_plugin({ id: 'existing' }),
                    create_scanned_plugin({ id: 'manual-edit' }),
                    create_scanned_plugin({ id: 'fresh' }),
                ],
                isScanning: false,
            })
        );
    });

    it('no-ops when a scan is already in flight', async () => {
        mocks.pluginScanStoreValue.value.isScanning = true;

        await scanCustomPaths(['/custom']);

        expect(mocks.pluginScanStoreSet).not.toHaveBeenCalled();
        expect(mocks.scanPlugins).not.toHaveBeenCalled();
    });
});
