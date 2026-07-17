import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { defaultPreferences } from '../../models/Preferences';
import { validateStoredPreferences } from '../preferencesStore';

describe('validateStoredPreferences', () => {
    beforeEach(() => {
        // Rejected fields are logged via logger.warn; silence it so the test output
        // stays clean and the assertions stand on the returned value alone.
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    it('replaces a corrupt enum field (theme: null) with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, theme: null });

        expect(result.theme).toBe(defaultPreferences.theme);
    });

    it('replaces an out-of-range enum field (bufferSize: 999) with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, bufferSize: 999 });

        expect(result.bufferSize).toBe(defaultPreferences.bufferSize);
    });

    it('preserves valid stored fields that differ from the defaults', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            theme: 'light',
            bufferSize: 1024,
            autoSave: false,
        });

        expect(result.theme).toBe('light');
        expect(result.bufferSize).toBe(1024);
        expect(result.autoSave).toBe(false);
    });

    it('returns all defaults for non-object input', () => {
        expect(validateStoredPreferences(null)).toEqual(defaultPreferences);
        expect(validateStoredPreferences('not-an-object')).toEqual(defaultPreferences);
        expect(validateStoredPreferences(42)).toEqual(defaultPreferences);
    });

    it('returns a distinct copy that does not mutate defaultPreferences', () => {
        // Capture the canonical defaults before any mutation so we can prove they survive.
        const themeBefore = defaultPreferences.theme;
        const bufferSizeBefore = defaultPreferences.bufferSize;

        const result = validateStoredPreferences({ ...defaultPreferences });

        // The returned object must not be the shared defaults reference, and writing
        // non-default values through it must not leak back into the canonical defaults.
        expect(result).not.toBe(defaultPreferences);
        result.theme = 'light';
        result.bufferSize = 2048;
        expect(defaultPreferences.theme).toBe(themeBefore);
        expect(defaultPreferences.bufferSize).toBe(bufferSizeBefore);
    });
});
