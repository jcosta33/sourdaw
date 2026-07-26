import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { loadExportSettings, saveExportSettings } from '../exportSettings';

const EXPORT_SETTINGS_KEY = 'sourdaw:export-settings';

describe('exportSettings', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should default invalid stored settings before they hydrate into UI state', () => {
        window.localStorage.setItem(
            EXPORT_SETTINGS_KEY,
            JSON.stringify({
                formats: ['wav', 'bogus'],
                sampleRate: 'fast',
                bitDepth: 99,
                mp3BitRate: 999,
            })
        );

        expect(loadExportSettings()).toEqual({
            formats: ['wav'],
            sampleRate: 44100,
            bitDepth: 24,
            mp3BitRate: 128,
            dither: 'random',
            normalization: 'off',
        });
    });

    it('should preserve valid neighboring fields when other settings are invalid', () => {
        window.localStorage.setItem(
            EXPORT_SETTINGS_KEY,
            JSON.stringify({
                formats: ['flac', 'bad'],
                sampleRate: 48000,
                bitDepth: 'deep',
                mp3BitRate: 320,
            })
        );

        expect(loadExportSettings()).toEqual({
            formats: ['flac'],
            sampleRate: 48000,
            bitDepth: 24,
            mp3BitRate: 320,
            dither: 'random',
            normalization: 'off',
        });
    });

    it('should hydrate a valid legacy format value as a single format list', () => {
        window.localStorage.setItem(
            EXPORT_SETTINGS_KEY,
            JSON.stringify({
                format: 'mp3',
                sampleRate: 96000,
                bitDepth: 16,
                mp3BitRate: 192,
            })
        );

        expect(loadExportSettings()).toEqual({
            formats: ['mp3'],
            sampleRate: 96000,
            bitDepth: 16,
            mp3BitRate: 192,
            dither: 'random',
            normalization: 'off',
        });
    });

    it('should load valid stored settings without writing back to localStorage', () => {
        window.localStorage.setItem(
            EXPORT_SETTINGS_KEY,
            JSON.stringify({
                formats: ['flac', 'mp3'],
                sampleRate: 88200,
                bitDepth: 32,
                mp3BitRate: 320,
            })
        );
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        expect(loadExportSettings()).toEqual({
            formats: ['flac', 'mp3'],
            sampleRate: 88200,
            bitDepth: 32,
            mp3BitRate: 320,
            dither: 'random',
            normalization: 'off',
        });
        expect(setItem).not.toHaveBeenCalled();
    });

    it('should load valid stored settings when storage writes fail', () => {
        window.localStorage.setItem(
            EXPORT_SETTINGS_KEY,
            JSON.stringify({
                formats: ['wav', 'flac'],
                sampleRate: 48000,
                bitDepth: 16,
                mp3BitRate: 96,
            })
        );
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        expect(loadExportSettings()).toEqual({
            formats: ['wav', 'flac'],
            sampleRate: 48000,
            bitDepth: 16,
            mp3BitRate: 96,
            dither: 'random',
            normalization: 'off',
        });
    });

    it('should hydrate defaults from invalid JSON and invalid top-level shapes', () => {
        for (const storedValue of ['not-json', JSON.stringify(null), JSON.stringify([])]) {
            window.localStorage.setItem(EXPORT_SETTINGS_KEY, storedValue);

            expect(loadExportSettings()).toEqual({
                formats: ['wav'],
                sampleRate: 44100,
                bitDepth: 24,
                mp3BitRate: 128,
                dither: 'random',
                normalization: 'off',
            });
        }
    });

    it('should hydrate default formats from empty or invalid format lists', () => {
        for (const formats of [[], ['bogus']]) {
            window.localStorage.setItem(
                EXPORT_SETTINGS_KEY,
                JSON.stringify({
                    formats,
                    sampleRate: 44100,
                    bitDepth: 24,
                    mp3BitRate: 128,
                })
            );

            expect(loadExportSettings()).toEqual({
                formats: ['wav'],
                sampleRate: 44100,
                bitDepth: 24,
                mp3BitRate: 128,
                dither: 'random',
                normalization: 'off',
            });
        }
    });

    it('should keep a stored dither preference and reject an unknown one', () => {
        for (const [stored, expected] of [
            ['seeded', 'seeded'],
            ['none', 'none'],
            ['random', 'random'],
            ['crunchy', 'random'],
            [42, 'random'],
        ] as const) {
            window.localStorage.setItem(
                EXPORT_SETTINGS_KEY,
                JSON.stringify({ formats: ['wav'], sampleRate: 44100, bitDepth: 24, mp3BitRate: 128, dither: stored })
            );

            expect(loadExportSettings().dither).toBe(expected);
        }
    });

    it('should save the existing plain JSON shape under the existing key', () => {
        saveExportSettings({
            formats: ['wav', 'mp3'],
            sampleRate: 48000,
            bitDepth: 24,
            mp3BitRate: 192,
            dither: 'seeded',
            normalization: 'off',
        });

        expect(window.localStorage.getItem(EXPORT_SETTINGS_KEY)).toBe(
            JSON.stringify({
                formats: ['wav', 'mp3'],
                sampleRate: 48000,
                bitDepth: 24,
                mp3BitRate: 192,
                dither: 'seeded',
                normalization: 'off',
            })
        );
    });
});
