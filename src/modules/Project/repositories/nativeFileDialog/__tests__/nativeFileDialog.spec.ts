import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isDesktopRuntime, readFileBytes } from '#/utils/desktopBridge';

import { openViaNative } from '../openViaNative';
import { pickFiles } from '../pickFiles';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    readFileBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

vi.mock('../openViaNative', () => ({
    openViaNative: vi.fn(),
}));

describe('nativeFileDialog', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('pickFiles', () => {
        it('should return File objects on desktop', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(openViaNative).mockResolvedValue(['/path/test.wav']);

            vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

            const result = await pickFiles();
            expect(result).toHaveLength(1);
            expect(result![0]).toBeInstanceOf(File);
            expect(result![0]!.name).toBe('test.wav');
            expect(result![0]!.size).toBe(3);
            expect(readFileBytes).toHaveBeenCalledWith({ path: '/path/test.wav' });
        });

        it('should derive File names from native Windows paths', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(openViaNative).mockResolvedValue(['C:\\Users\\jose\\Samples\\kick.wav']);

            const result = await pickFiles();

            expect(result).toHaveLength(1);
            expect(result![0]!.name).toBe('kick.wav');
            expect(readFileBytes).toHaveBeenCalledWith({ path: 'C:\\Users\\jose\\Samples\\kick.wav' });
        });

        it('returns browser fallback Files without reading their names as paths', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            const file = new File(['selected content'], 'fallback.wav');
            vi.mocked(openViaNative).mockResolvedValue({ kind: 'browser-files', files: [file] });

            const result = await pickFiles();

            expect(result?.[0]).toBe(file);
            expect(readFileBytes).not.toHaveBeenCalled();
        });

        it('should reject native read failures after a native selection without opening a browser picker', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(true);
            vi.mocked(openViaNative).mockResolvedValue(['/path/test.wav']);
            vi.mocked(readFileBytes).mockRejectedValue(new Error('native read denied'));
            const createElementSpy = vi.spyOn(document, 'createElement');

            try {
                await expect(pickFiles()).rejects.toThrow('native read denied');
                expect(createElementSpy).not.toHaveBeenCalled();
            } finally {
                createElementSpy.mockRestore();
            }
        });

        it('should use browser fallback in the browser', async () => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
                this: HTMLInputElement
            ) {
                this.dispatchEvent(new Event('cancel'));
            });

            await expect(pickFiles()).resolves.toBeNull();

            expect(click).toHaveBeenCalledOnce();
            expect(openViaNative).not.toHaveBeenCalled();
            expect(readFileBytes).not.toHaveBeenCalled();
        });

        it('should resolve to null when focus returns without a change or cancel event', async () => {
            // Regression: some environments (older Electron / Chromium) never fire
            // the input `cancel` event, so a dismissed dialog left the Promise
            // pending forever. A window-focus fallback must resolve it to null.
            vi.useFakeTimers();
            try {
                vi.mocked(isDesktopRuntime).mockReturnValue(false);
                // Use a real <input> so the focus listener binds to the real window,
                // and suppress the native picker.
                vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

                const pending = pickFiles();

                // The dialog is dismissed: no change/cancel event ever fires, only
                // focus returning to the window.
                window.dispatchEvent(new Event('focus'));
                await vi.advanceTimersByTimeAsync(300);

                await expect(pending).resolves.toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
