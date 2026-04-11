import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    setScanProgress: vi.fn(),
}));

vi.mock('../repositories/libraryPersistence', () => ({
    persistLibraryRoots: vi.fn(),
    persistSamples: vi.fn(),
}));

vi.mock('./buildFolderTree', () => ({
    buildFolderTree: vi.fn(),
}));

import { connectFolder, cancelScan, rescanRoot } from './connectFolder';

describe('connectFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when no directory picker is available (and not in Tauri)', async () => {
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
