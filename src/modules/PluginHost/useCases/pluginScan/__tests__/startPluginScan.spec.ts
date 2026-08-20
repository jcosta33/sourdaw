import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../models/ScannedPlugin';
import { type PluginScanState } from '../../../stores/pluginScanStore';
import { startPluginScan } from '../scanning/startPluginScan';

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
        pluginScanStoreSet: vi.fn<typeof import('../../../stores/pluginScanStore').pluginScanStore.set>(),
        pluginScanStoreUpdate: vi.fn<typeof import('../../../stores/pluginScanStore').pluginScanStore.update>(),
        scanPlugins: vi.fn<typeof import('../../../repositories/pluginBridge/scanPlugins').scanPlugins>(),
        getDefaultPluginPaths:
            vi.fn<typeof import('../../../repositories/pluginBridge/getDefaultPluginPaths').getDefaultPluginPaths>(),
    };
});

function makeScannedPlugin(overrides: Partial<ScannedPlugin> = {}): ScannedPlugin {
    return {
        id: 'p1',
        name: 'Synth',
        vendor: 'Acme Audio',
        format: 'VST3',
        category: 'Instrument',
        path: '/plugins/synth.vst3',
        version: '1.0.0',
        clap_id: 'com.test.plugin',
        num_inputs: 0,
        num_outputs: 2,
        num_parameters: 8,
        has_custom_ui: false,
        ...overrides,
    };
}

vi.mock('../../../stores/pluginScanStore', () => ({
    pluginScanStore: {
        get value() {
            return mocks.pluginScanStoreValue.value;
        },
        set: mocks.pluginScanStoreSet,
        update: mocks.pluginScanStoreUpdate,
    },
}));

vi.mock('../../../repositories/pluginBridge/scanPlugins', () => ({
    scanPlugins: mocks.scanPlugins,
}));

vi.mock('../../../repositories/pluginBridge/getDefaultPluginPaths', () => ({
    getDefaultPluginPaths: mocks.getDefaultPluginPaths,
}));

describe('startPluginScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pluginScanStoreValue.value = {
            scanPaths: [],
            isScanning: false,
            scannedPlugins: [],
            errors: [],
            notices: [],
            lastScanTime: null,
        };
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
        const mockPlugins = [makeScannedPlugin()];
        mocks.scanPlugins.mockResolvedValue({ plugins: mockPlugins, errors: [], notices: [], scan_duration_ms: 5 });

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

    it('merges existing paths with default paths', async () => {
        mocks.pluginScanStoreValue.value.scanPaths = ['/custom/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
        mocks.scanPlugins.mockResolvedValue({ plugins: [], errors: [], notices: [], scan_duration_ms: 0 });

        await startPluginScan();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(expect.arrayContaining(['/custom/path', '/default/path']));
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
