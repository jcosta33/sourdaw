import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    setScanProgress: vi.fn(),
}));

vi.mock('../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: vi.fn(),
}));

vi.mock('../../repositories/libraryPersistence/persistLibraryRoots', () => ({
    persistLibraryRoots: vi.fn(),
}));

vi.mock('../buildFolderTree', () => ({
    buildFolderTree: vi.fn(),
}));

import { cancelScan } from '../connectFolder/cancelScan';
import { connectFolder } from '../connectFolder/connectFolder';
import { rescanRoot } from '../connectFolder/rescanRoot';

describe('connectFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when no directory picker is available (and not in the desktop app)', async () => {
        // jsdom does not implement showDirectoryPicker
        delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
        const result = await connectFolder();
        expect(result).toBeNull();
    });

    it('cancelScan does not throw when no scan is active', () => {
        expect(() => cancelScan()).not.toThrow();
    });

    it('rescanRoot noops when the root is missing', async () => {
        await expect(rescanRoot('missing')).resolves.toBeUndefined();
    });
});
