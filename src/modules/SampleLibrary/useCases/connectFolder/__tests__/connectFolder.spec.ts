import { describe, it, expect, vi, beforeEach } from 'vitest';

const pickTauriSampleFolder = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

vi.mock('../../../repositories/pickTauriSampleFolder', () => ({
    pickTauriSampleFolder,
}));

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

import { addLibraryRoot } from '../../../stores/libraryStore';
import { connectFolder } from '../connectFolder';

describe('connectFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pickTauriSampleFolder.mockReset();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
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

    it('should derive a stable folder basename from a native Windows Tauri path', async () => {
        const selected_path = String.raw`C:\Users\jose\Samples`;
        Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
        pickTauriSampleFolder.mockResolvedValue(selected_path);

        const result = await connectFolder();

        expect(result).toMatch(/^lib-/);
        expect(pickTauriSampleFolder).toHaveBeenCalledTimes(1);
        expect(vi.mocked(addLibraryRoot)).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Samples',
                provider: 'tauri',
                rootRef: selected_path,
                settings: { recursive: true },
                status: 'scanning',
            })
        );
    });

    it('should return null when the native Tauri directory picker is cancelled', async () => {
        Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
        pickTauriSampleFolder.mockResolvedValue(null);

        const result = await connectFolder();

        expect(result).toBeNull();
        expect(vi.mocked(addLibraryRoot)).not.toHaveBeenCalled();
    });
});
