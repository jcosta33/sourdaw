import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startPluginScan } from '../scanning/startPluginScan';

const mocks = vi.hoisted(() => ({
    pluginScanStoreValue: {
        value: {
            scanPaths: [] as string[],
            isScanning: false,
            scannedPlugins: [] as unknown[],
            errors: [] as string[],
        },
    },
    pluginScanStoreSet: vi.fn<typeof import('../../../stores/pluginScanStore').pluginScanStore.set>(),
    scanPlugins: vi.fn<typeof import('../../../repositories/pluginBridge/scanPlugins').scanPlugins>(),
    getDefaultPluginPaths:
        vi.fn<typeof import('../../../repositories/pluginBridge/getDefaultPluginPaths').getDefaultPluginPaths>(),
}));

vi.mock('../../../stores/pluginScanStore', () => ({
    pluginScanStore: {
        get value() {
            return mocks.pluginScanStoreValue.value;
        },
        set: mocks.pluginScanStoreSet,
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
        } as unknown as typeof mocks.pluginScanStoreValue.value;
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
    });

    it('sets isScanning and then updates with results', async () => {
        const mockPlugins = [{ id: 'p1', name: 'Synth' }];
        mocks.scanPlugins.mockResolvedValue({ plugins: mockPlugins, errors: [] });

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
        mocks.scanPlugins.mockResolvedValue({ plugins: [], errors: [] });

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
});
