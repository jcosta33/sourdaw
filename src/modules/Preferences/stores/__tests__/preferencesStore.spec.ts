import { parse, stringify } from 'superjson';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { defaultPreferences } from '../../models/Preferences';
import { preferencesStore } from '../preferencesStore';

describe('preferencesStore', () => {
    beforeEach(() => {
        // Reset to a known state if possible, though createStore might be a singleton
        // For unit tests, we mainly care about the store instance behavior
    });

    it('should have initial preferences', () => {
        expect(preferencesStore.value).toBeDefined();
        // Check for some expected default keys from helpers.ts
        expect(preferencesStore.value).toHaveProperty('theme');
        expect(preferencesStore.value).toHaveProperty('autoSave');
    });

    it('should update preferences', () => {
        const original = preferencesStore.value;
        preferencesStore.update((state) => ({
            ...state!,
            theme: 'light',
        }));

        expect(preferencesStore.value?.theme).toBe('light');

        // Restore
        preferencesStore.set(original);
    });
});

describe('preferencesStore — present-but-corrupt persisted blob', () => {
    const STORAGE_KEY = 'sourdaw-preferences';

    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('returns the schema-validated form (not the raw corrupt blob) when a present blob has invalid fields', async () => {
        // A non-null but schema-invalid blob already present in localStorage at
        // store-module load: `theme` is null (invalid enum) and `autoSave` is a
        // string. The createStore seeding guard ("seed only when storage is
        // null") would otherwise leave these raw values in `.value`.
        window.localStorage.setItem(STORAGE_KEY, stringify({ theme: null, autoSave: 'yes', uiScale: 1.5 }));

        // The singleton is built at module init; force a fresh instance so
        // createStore sanitizes the corrupt blob we just seeded.
        vi.resetModules();
        const fresh = (await import('../preferencesStore')).preferencesStore;

        // Read boundary must return the sanitized form: invalid fields fall back
        // to defaults, valid fields are preserved.
        expect(fresh.value?.theme).toBe('dark'); // invalid null → default
        expect(fresh.value?.autoSave).toBe(true); // invalid 'yes' → default
        expect(fresh.value?.uiScale).toBe(1.5); // valid → preserved

        // And the validated form is the actual stored form (write-through), so a
        // later consumer reading the raw blob also sees the sanitized values.
        const persisted = window.localStorage.getItem(STORAGE_KEY);
        expect(persisted).not.toBeNull();
        expect(persisted).not.toContain('"theme":null');
    });
});

describe('preferencesStore — empty persisted storage (first run)', () => {
    const STORAGE_KEY = 'sourdaw-preferences';

    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('seeds localStorage under the "sourdaw-preferences" wire key with defaultPreferences on first load', async () => {
        vi.resetModules();
        const fresh = (await import('../preferencesStore')).preferencesStore;

        expect(fresh.value).toEqual(defaultPreferences);

        const persisted = window.localStorage.getItem(STORAGE_KEY);
        expect(persisted).not.toBeNull();
        expect(parse(persisted as string)).toEqual(defaultPreferences);
    });

    it('persists a subsequent set() under the same wire key in superjson format', async () => {
        vi.resetModules();
        const fresh = (await import('../preferencesStore')).preferencesStore;

        fresh.set({ ...defaultPreferences, theme: 'light', audioLatencyProfile: 'highCapacity' });

        const persisted = window.localStorage.getItem(STORAGE_KEY);
        expect(persisted).not.toBeNull();
        expect(parse(persisted as string)).toMatchObject({
            theme: 'light',
            audioLatencyProfile: 'highCapacity',
        });
    });

    it('seeds a visible 28px minimap under the current preferences schema', async () => {
        vi.resetModules();
        const fresh = (await import('../preferencesStore')).preferencesStore;

        expect(fresh.value).toMatchObject({
            preferencesSchemaVersion: 2,
            showMinimap: true,
            timelineMinimapHeight: 28,
        });
    });
});

describe('preferencesStore — legacy minimap visibility migration', () => {
    const STORAGE_KEY = 'sourdaw-preferences';

    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('writes the migrated visible baseline back once, then honors a later explicit hidden choice', async () => {
        window.localStorage.setItem(STORAGE_KEY, stringify({ showMinimap: false, theme: 'light' }));
        vi.resetModules();
        const fresh = (await import('../preferencesStore')).preferencesStore;

        expect(fresh.value).toMatchObject({
            preferencesSchemaVersion: 2,
            showMinimap: true,
            timelineMinimapHeight: 28,
        });

        fresh.set({ ...fresh.value!, showMinimap: false });
        vi.resetModules();
        const reloaded = (await import('../preferencesStore')).preferencesStore;

        expect(reloaded.value?.showMinimap).toBe(false);
        expect(reloaded.value?.preferencesSchemaVersion).toBe(2);
    });
});
