import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    setScanProgress: vi.fn(),
}));

vi.mock('../helpers', () => ({
    scanBrowserDirectory: vi.fn(),
    scanTauriDirectory: vi.fn(),
}));

import { connectFolder } from '../connectFolder';

describe('connectFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it('returns null in the browser when the directory-picker API is unavailable', async () => {
        // jsdom does not implement showDirectoryPicker; the browser path bails out.
        delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;

        const result = await connectFolder();

        expect(result).toBeNull();
    });

    it('returns null when the user cancels the directory picker', async () => {
        (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = vi
            .fn()
            .mockRejectedValue(new DOMException('aborted', 'AbortError'));

        const result = await connectFolder();

        expect(result).toBeNull();
    });
});
