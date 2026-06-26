import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scanCustomPaths } from '../scanCustomPaths';

const mocks = vi.hoisted(() => ({
    pluginScanStoreValue: {
        value: {
            scanPaths: [] as string[],
            isScanning: false,
            scannedPlugins: [] as { id: string }[],
            errors: [] as string[],
            lastScanTime: null as number | null,
        },
    },
    pluginScanStoreSet: vi.fn<typeof import('../../../../stores/pluginScanStore').pluginScanStore.set>(),
    scanPlugins: vi.fn<typeof import('../../../../repositories/pluginBridge/scanPlugins').scanPlugins>(),
}));

vi.mock('../../../../stores/pluginScanStore', () => ({
    pluginScanStore: {
        get value() {
            return mocks.pluginScanStoreValue.value;
        },
        set: mocks.pluginScanStoreSet,
    },
    defaultPluginScanState: {},
}));

vi.mock('../../../../repositories/pluginBridge/scanPlugins', () => ({
    scanPlugins: mocks.scanPlugins,
}));

describe('scanCustomPaths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pluginScanStoreValue.value = {
            scanPaths: [],
            isScanning: false,
            scannedPlugins: [],
            errors: [],
            lastScanTime: null,
        };
    });

    it('appends only plugins not already scanned', async () => {
        mocks.pluginScanStoreValue.value.scannedPlugins = [{ id: 'existing' }];
        const scanned = [{ id: 'existing' }, { id: 'fresh' }];
        mocks.scanPlugins.mockResolvedValue({ plugins: scanned, errors: [] });

        await scanCustomPaths(['/custom']);

        expect(mocks.scanPlugins).toHaveBeenCalledWith(['/custom']);
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                scannedPlugins: [{ id: 'existing' }, { id: 'fresh' }],
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
