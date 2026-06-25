import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri } from '#/utils/tauriBridge';

import * as helpers from '../helpers';
import { openFileDialog } from '../openFileDialog';
import { pickFiles } from '../pickFiles';
import { saveFileDialog } from '../saveFileDialog';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
}));

vi.mock('../helpers', () => ({
    openViaBrowser: vi.fn(),
    openViaTauri: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
}));

describe('nativeFileDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('openFileDialog', () => {
        it('should use openViaTauri when in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(helpers.openViaTauri).mockResolvedValue(['/path/file.wav']);

            const result = await openFileDialog();
            expect(result).toEqual(['/path/file.wav']);
            expect(helpers.openViaTauri).toHaveBeenCalled();
        });

        it('should use openViaBrowser when not in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            vi.mocked(helpers.openViaBrowser).mockResolvedValue(['file.wav']);

            const result = await openFileDialog();
            expect(result).toEqual(['file.wav']);
            expect(helpers.openViaBrowser).toHaveBeenCalled();
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
            // We need to mock the dynamic import of @tauri-apps/plugin-dialog
            // Since it's inside saveFileDialog.ts, we mock it globally
            vi.mock('@tauri-apps/plugin-dialog', () => ({
                save: vi.fn().mockResolvedValue('/save/path.wav'),
            }));

            const result = await saveFileDialog({ defaultPath: 'test.wav' });
            expect(result).toBe('/save/path.wav');
        });
    });

    describe('pickFiles', () => {
        it('should return File objects in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(helpers.openViaTauri).mockResolvedValue(['/path/test.wav']);

            const result = await pickFiles();
            expect(result).toHaveLength(1);
            expect(result![0]).toBeInstanceOf(File);
            expect(result![0]!.name).toBe('test.wav');
        });

        it('should use browser fallback when not in Tauri', () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const mockInput = {
                click: vi.fn(),
                addEventListener: vi.fn(),
                type: '',
            };
            vi.spyOn(document, 'createElement').mockReturnValue(mockInput as unknown as HTMLInputElement);

            void pickFiles();
            expect(mockInput.click).toHaveBeenCalled();
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
