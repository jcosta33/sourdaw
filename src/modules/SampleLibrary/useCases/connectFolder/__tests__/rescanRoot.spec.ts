import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    scanBrowserDirectory: vi.fn(),
    scanTauriDirectory: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    storeValue: { value: null as unknown },
}));

vi.mock('../helpers', () => ({
    scanBrowserDirectory: mocks.scanBrowserDirectory,
    scanTauriDirectory: mocks.scanTauriDirectory,
}));

vi.mock('../../../stores/libraryStore', () => ({
    get libraryStore() {
        return mocks.storeValue;
    },
    updateLibraryRootStatus: mocks.updateLibraryRootStatus,
}));

import { rescanRoot } from '../rescanRoot';

type TestRoot = {
    id: string;
    provider: 'browser' | 'tauri';
    handle?: object;
};

function seedRoots(roots: TestRoot[]): void {
    mocks.storeValue.value = { roots };
}

describe('rescanRoot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('no-ops when the root id is not present', async () => {
        seedRoots([{ id: 'r1', provider: 'browser', handle: {} }]);

        await rescanRoot('missing');

        expect(mocks.updateLibraryRootStatus).not.toHaveBeenCalled();
        expect(mocks.scanBrowserDirectory).not.toHaveBeenCalled();
        expect(mocks.scanTauriDirectory).not.toHaveBeenCalled();
    });

    it('does not strand a handle-less browser root on a permanent "scanning" status', async () => {
        // A permission_required / offline browser root has no live handle. No
        // scanner runs for it, so it must never be flipped to 'scanning' — doing
        // so would leave the UI spinner spinning forever.
        seedRoots([{ id: 'r1', provider: 'browser' }]);

        await rescanRoot('r1');

        expect(mocks.updateLibraryRootStatus).not.toHaveBeenCalled();
        expect(mocks.scanBrowserDirectory).not.toHaveBeenCalled();
        expect(mocks.scanTauriDirectory).not.toHaveBeenCalled();
    });

    it('scans a browser root that still holds a handle and marks it scanning', async () => {
        const handle = {};
        seedRoots([{ id: 'r1', provider: 'browser', handle }]);

        await rescanRoot('r1');

        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('r1', 'scanning');
        expect(mocks.scanBrowserDirectory).toHaveBeenCalledTimes(1);
        expect(mocks.scanTauriDirectory).not.toHaveBeenCalled();
    });

    it('scans a tauri root and marks it scanning', async () => {
        seedRoots([{ id: 'r1', provider: 'tauri' }]);

        await rescanRoot('r1');

        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('r1', 'scanning');
        expect(mocks.scanTauriDirectory).toHaveBeenCalledTimes(1);
        expect(mocks.scanBrowserDirectory).not.toHaveBeenCalled();
    });
});
