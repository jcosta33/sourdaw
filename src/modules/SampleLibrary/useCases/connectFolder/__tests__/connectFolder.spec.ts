import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isDesktopRuntime } from '#/utils/desktopRuntime';

const pickNativeSampleFolder = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: vi.fn(),
}));

vi.mock('../../../repositories/pickNativeSampleFolder', () => ({
    pickNativeSampleFolder,
}));

vi.mock('../../../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
    setScanProgress: vi.fn(),
}));

vi.mock('../scanBrowserDirectory', () => ({ scanBrowserDirectory: vi.fn() }));
vi.mock('../scanNativeDirectory', () => ({ scanNativeDirectory: vi.fn() }));

import { addLibraryRoot } from '../../../stores/libraryStore';
import { connectFolder } from '../connectFolder';

describe('connectFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pickNativeSampleFolder.mockReset();
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
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

    it('should derive a stable folder basename from a native Windows path', async () => {
        const selected_path = String.raw`C:\Users\jose\Samples`;
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        pickNativeSampleFolder.mockResolvedValue(selected_path);

        const result = await connectFolder();

        expect(result).toMatch(/^lib-/);
        expect(pickNativeSampleFolder).toHaveBeenCalledTimes(1);
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

    it('should return null when the native directory picker is cancelled', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        pickNativeSampleFolder.mockResolvedValue(null);

        const result = await connectFolder();

        expect(result).toBeNull();
        expect(vi.mocked(addLibraryRoot)).not.toHaveBeenCalled();
    });
});
