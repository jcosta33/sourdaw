import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PluginScanState } from '../../../../stores/pluginScanStore';
import { addScanPath } from '../addScanPath';

const mocks = vi.hoisted(() => {
    const pluginScanStoreValue: { value: PluginScanState } = {
        value: {
            scanPaths: ['/existing'],
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
        isScanPathAuthorized:
            vi.fn<typeof import('../../../../repositories/pluginBridge/isScanPathAuthorized').isScanPathAuthorized>(),
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
    },
    defaultPluginScanState: {
        scannedPlugins: [],
        scanPaths: [],
        isScanning: false,
        lastScanTime: null,
        errors: [],
        notices: [],
    },
}));

vi.mock('../../../../repositories/pluginBridge/isScanPathAuthorized', () => ({
    isScanPathAuthorized: mocks.isScanPathAuthorized,
}));

vi.mock('../../../../repositories/pluginBridge/getDefaultPluginPaths', () => ({
    getDefaultPluginPaths: mocks.getDefaultPluginPaths,
}));

/** Assert the outcome is a refusal and hand back its reason. */
function refusalReason(outcome: Awaited<ReturnType<typeof addScanPath>>): string {
    if (outcome.added) {
        throw new Error('expected the add to be refused');
    }
    return outcome.reason;
}

describe('addScanPath', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pluginScanStoreValue.value = {
            scanPaths: ['/existing'],
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
        mocks.isScanPathAuthorized.mockResolvedValue(true);
        mocks.getDefaultPluginPaths.mockResolvedValue(['/root/vst3', '/root/clap']);
    });

    it('should append a path when it is not already present', async () => {
        await addScanPath('/new');
        expect(mocks.pluginScanStoreValue.value.scanPaths).toEqual(['/existing', '/new']);
    });

    it('should not duplicate an existing path', async () => {
        await addScanPath('/existing');
        expect(mocks.pluginScanStoreValue.value.scanPaths).toEqual(['/existing']);
    });

    it('refuses a path the scan policy can never authorize, naming the authorized roots', async () => {
        // Regression (#2378): the free-text add used to persist any path, and
        // every later scan rejected it with a permanent unauthorized error — a
        // settings entry that could never work. The add is now gated on the
        // same policy the scan enforces, and the refusal names the folders
        // that are scannable instead.
        mocks.isScanPathAuthorized.mockResolvedValue(false);

        const outcome = await addScanPath('/outside/plugin/folder');
        const reason = refusalReason(outcome);

        expect(reason).toContain('/outside/plugin/folder');
        expect(reason).toContain('/root/vst3');
        expect(reason).toContain('/root/clap');
        expect(mocks.pluginScanStoreValue.value.scanPaths).toEqual(['/existing']);
    });

    it('does not query the policy for a path that is already saved', async () => {
        await addScanPath('/existing');
        expect(mocks.isScanPathAuthorized).not.toHaveBeenCalled();
    });

    it('reports a policy query it could not ask as a refusal, not as an added path', async () => {
        mocks.isScanPathAuthorized.mockRejectedValue(new Error('IPC Failure'));

        const outcome = await addScanPath('/new');
        const reason = refusalReason(outcome);

        expect(reason).toContain('IPC Failure');
        expect(mocks.pluginScanStoreValue.value.scanPaths).toEqual(['/existing']);
    });
});
