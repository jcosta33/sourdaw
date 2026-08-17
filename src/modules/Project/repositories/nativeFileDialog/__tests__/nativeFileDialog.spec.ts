import { describe, it, expect, vi, beforeEach } from 'vitest';

import { desktopSaveDialog, isTauri, readFileBytes } from '#/utils/tauriBridge';

import { openViaBrowser } from '../helpers';
import { openFileDialog } from '../openFileDialog';
import { openViaTauri } from '../openViaTauri';
import { pickFiles } from '../pickFiles';
import { saveFileDialog } from '../saveFileDialog';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    readFileBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    desktopSaveDialog: vi.fn().mockResolvedValue('/save/path.wav'),
}));

vi.mock('../helpers', () => ({
    openViaBrowser: vi.fn(),
}));

vi.mock('../openViaTauri', () => ({
    openViaTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue([1, 2, 3]),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn().mockResolvedValue('/save/path.wav'),
}));

describe('nativeFileDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('openFileDialog', () => {
        it('should use openViaTauri when in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(openViaTauri).mockResolvedValue(['/path/file.wav']);

            const result = await openFileDialog();
            expect(result).toEqual(['/path/file.wav']);
            expect(openViaTauri).toHaveBeenCalled();
        });

        it('should use openViaBrowser when not in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            vi.mocked(openViaBrowser).mockResolvedValue(['file.wav']);

            const result = await openFileDialog();
            expect(result).toEqual(['file.wav']);
            expect(openViaBrowser).toHaveBeenCalled();
        });
    });

    describe('saveFileDialog', () => {
        it('should return null when not in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const result = await saveFileDialog();
            expect(result).toBeNull();
        });

        it('should use native save dialog in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(desktopSaveDialog).mockResolvedValue('/save/path.wav');

            const result = await saveFileDialog({ defaultPath: 'test.wav' });
            expect(result).toBe('/save/path.wav');
        });
    });

    describe('pickFiles', () => {
        it('should return File objects in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(openViaTauri).mockResolvedValue(['/path/test.wav']);

            vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

            const result = await pickFiles();
            expect(result).toHaveLength(1);
            expect(result![0]).toBeInstanceOf(File);
            expect(result![0]!.name).toBe('test.wav');
            expect(result![0]!.size).toBe(3);
            expect(readFileBytes).toHaveBeenCalledWith({ path: '/path/test.wav' });
        });

        it('should derive File names from native Windows Tauri paths', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(openViaTauri).mockResolvedValue(['C:\\Users\\jose\\Samples\\kick.wav']);

            const result = await pickFiles();

            expect(result).toHaveLength(1);
            expect(result![0]!.name).toBe('kick.wav');
            expect(readFileBytes).toHaveBeenCalledWith({ path: 'C:\\Users\\jose\\Samples\\kick.wav' });
        });

        it('should reject native read failures after a Tauri selection without opening a browser picker', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(openViaTauri).mockResolvedValue(['/path/test.wav']);
            vi.mocked(readFileBytes).mockRejectedValue(new Error('native read denied'));
            const createElementSpy = vi.spyOn(document, 'createElement');

            try {
                await expect(pickFiles()).rejects.toThrow('native read denied');
                expect(createElementSpy).not.toHaveBeenCalled();
            } finally {
                createElementSpy.mockRestore();
            }
        });

        it('should use browser fallback when not in Tauri', () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const mockInput = {
                click: vi.fn(),
                addEventListener: vi.fn(),
                type: '',
            };
            const createElementSpy = vi
                .spyOn(document, 'createElement')
                .mockReturnValue(mockInput as unknown as HTMLInputElement);

            try {
                void pickFiles();
                expect(mockInput.click).toHaveBeenCalled();
            } finally {
                createElementSpy.mockRestore();
            }
        });

        it('should resolve to null when focus returns without a change or cancel event', async () => {
            // Regression: some environments (older Electron / Chromium) never fire
            // the input `cancel` event, so a dismissed dialog left the Promise
            // pending forever. A window-focus fallback must resolve it to null.
            vi.useFakeTimers();
            try {
                vi.mocked(isTauri).mockReturnValue(false);
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
