import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../../models/ScannedPlugin';
import { type ScanResult } from '../../../../repositories/pluginBridge/types';
import { type PluginScanState } from '../../../../stores/pluginScanStore';
import { startPluginScan } from '../startPluginScan';

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
        getDefaultPluginPaths:
            vi.fn<typeof import('../../../../repositories/pluginBridge/getDefaultPluginPaths').getDefaultPluginPaths>(),
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
}));

vi.mock('../../../../repositories/pluginBridge/scanPlugins', () => ({
    scanPlugins: mocks.scanPlugins,
}));

vi.mock('../../../../repositories/pluginBridge/getDefaultPluginPaths', () => ({
    getDefaultPluginPaths: mocks.getDefaultPluginPaths,
}));

describe('startPluginScan', () => {
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
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
    });

    it('sets isScanning and then updates with results', async () => {
        const mockPlugins = [create_scanned_plugin({ id: 'p1', name: 'Synth' })];
        mocks.scanPlugins.mockResolvedValue({ plugins: mockPlugins, errors: [], notices: [], scan_duration_ms: 0 });

        await startPluginScan();

        // Check start state
        expect(mocks.pluginScanStoreSet).toHaveBeenCalledWith(expect.objectContaining({ isScanning: true }));

        // Check end state
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                scannedPlugins: mockPlugins,
                errors: [],
            })
        );
    });

    it('keeps a scan that only refused formats out of the error channel', async () => {
        // The ordinary outcome for anyone who owns a VST3 plugin: the VST3
        // roots are scanned by default on every platform, so this runs on every
        // scan. Routed into `errors` it would render the scan destructively and
        // withhold the success badge — which is gated on `errors.length === 0`
        // — permanently, for a scan in which nothing failed.
        const refusal = 'VST3 plugins are recognised but not loaded yet.';
        mocks.scanPlugins.mockResolvedValue({
            plugins: [create_scanned_plugin({ id: 'p1', format: 'clap' })],
            errors: [],
            notices: [refusal],
            scan_duration_ms: 0,
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: [],
                notices: [refusal],
            })
        );
    });

    it('reports failures and refusals on their own channels at once', async () => {
        // Neither channel absorbs the other: a scan can fail on one root and
        // refuse a format under another, and the user has to be able to tell
        // which is which.
        mocks.scanPlugins.mockResolvedValue({
            plugins: [],
            errors: ['Cannot read /default/path: permission denied'],
            notices: ['Audio Unit plugins are not loaded.'],
            scan_duration_ms: 0,
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                errors: ['Cannot read /default/path: permission denied'],
                notices: ['Audio Unit plugins are not loaded.'],
            })
        );
    });

    it('merges existing paths with default paths', async () => {
        mocks.pluginScanStoreValue.value.scanPaths = ['/custom/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
        mocks.scanPlugins.mockResolvedValue({ plugins: [], errors: [], notices: [], scan_duration_ms: 0 });

        await startPluginScan();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(expect.arrayContaining(['/custom/path', '/default/path']));
    });

    it('should not restore a scan path removed while scanPlugins is awaiting', async () => {
        mocks.pluginScanStoreValue.value.scanPaths = ['/removed/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue([]);
        const scan_deferred = create_deferred<ScanResult>();
        mocks.scanPlugins.mockReturnValue(scan_deferred.promise);

        const scan_promise = startPluginScan();
        await Promise.resolve();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(['/removed/path']);

        mocks.pluginScanStoreValue.value = {
            ...mocks.pluginScanStoreValue.value,
            scanPaths: [],
        };
        scan_deferred.resolve({ plugins: [], errors: [], notices: [], scan_duration_ms: 0 });
        await scan_promise;

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                scanPaths: [],
                isScanning: false,
            })
        );
    });

    it('sets error if no paths are configured or found', async () => {
        mocks.getDefaultPluginPaths.mockResolvedValue([]);

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['No plugin paths configured'],
            })
        );
    });

    it('handles repository errors gracefully', async () => {
        mocks.scanPlugins.mockRejectedValue(new Error('IPC Failure'));

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['IPC Failure'],
            })
        );
    });

    it('no-ops when a scan is already in flight', async () => {
        mocks.pluginScanStoreValue.value.isScanning = true;

        await startPluginScan();

        // Guard returns before touching the store or the IPC bridge.
        expect(mocks.pluginScanStoreSet).not.toHaveBeenCalled();
        expect(mocks.getDefaultPluginPaths).not.toHaveBeenCalled();
        expect(mocks.scanPlugins).not.toHaveBeenCalled();
    });
});
