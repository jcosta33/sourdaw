import { parse, stringify } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ShortcutStoreState } from '../shortcutStore';

const STORAGE_KEY = 'sourdaw-shortcut-bindings';
const LEGACY_STORAGE_KEY = 'sourdaw-shortcuts';

function storedMappings(customMappings: Record<string, string[]>): string {
    return stringify({ definitions: [], customMappings });
}

async function importFreshShortcutStore(): Promise<ShortcutStoreState | null> {
    vi.resetModules();
    const { shortcutStore } = await import('../shortcutStore');
    return shortcutStore.value;
}

describe('shortcutStore hydration', () => {
    afterEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    it('should hydrate current definitions while preserving valid custom mappings', async () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            stringify({
                definitions: [
                    {
                        id: 'stale.definition',
                        label: 'Stale persisted definition',
                        category: 'workflow',
                        defaultKeys: ['shift+x'],
                        action: { type: 'callback', id: 'staleCallback' },
                    },
                ],
                customMappings: {
                    'editing.undo': ['mod+u'],
                    'transport.togglePlayback': ['Space', 'shift+Space'],
                    'view.zoomIn': 'mod+=',
                    'view.zoomOut': ['mod+-', 1],
                    'workspace.toggleMixer': [],
                },
            })
        );

        const state = await importFreshShortcutStore();

        expect(state?.definitions.some((definition) => definition.id === 'transport.togglePlayback')).toBe(true);
        expect(state?.definitions.some((definition) => definition.id === 'stale.definition')).toBe(false);
        expect(state?.customMappings).toEqual({
            'editing.undo': ['mod+u'],
            'transport.togglePlayback': ['Space', 'shift+Space'],
            'workspace.toggleMixer': [],
        });
    });

    it('should default invalid customMappings containers to an empty mapping set', async () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            stringify({
                definitions: [],
                customMappings: ['editing.undo', 'mod+u'],
            })
        );

        const state = await importFreshShortcutStore();

        expect(state?.definitions.some((definition) => definition.id === 'editing.undo')).toBe(true);
        expect(state?.customMappings).toEqual({});
    });

    it('keeps a current binding that names a US shifted or Option character across reloads', async () => {
        // AZERTY Shift+Digit1 and Danish Option+Æ, as the physical-key capture stores them.
        const current = { 'transport.toggleLoop': ['shift+&'], 'transport.toggleMetronome': ['alt+æ'] };
        window.localStorage.setItem(STORAGE_KEY, storedMappings(current));

        expect((await importFreshShortcutStore())?.customMappings).toEqual(current);
        expect((await importFreshShortcutStore())?.customMappings).toEqual(current);
    });

    it('seeds the current key from legacy produced-character bindings, migrated', async () => {
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY,
            storedMappings({ 'transport.toggleLoop': ['shift+!'], 'transport.toggleMetronome': ['alt+∂'] })
        );

        const migrated = { 'transport.toggleLoop': ['shift+1'], 'transport.toggleMetronome': ['alt+d'] };
        expect((await importFreshShortcutStore())?.customMappings).toEqual(migrated);
        expect(parse<ShortcutStoreState>(window.localStorage.getItem(STORAGE_KEY) ?? '').customMappings).toEqual(
            migrated
        );
    });

    it('ignores legacy bindings once the current key exists', async () => {
        window.localStorage.setItem(STORAGE_KEY, storedMappings({ 'transport.toggleLoop': ['shift+&'] }));
        window.localStorage.setItem(LEGACY_STORAGE_KEY, storedMappings({ 'transport.toggleLoop': ['shift+!'] }));

        expect((await importFreshShortcutStore())?.customMappings).toEqual({ 'transport.toggleLoop': ['shift+&'] });
    });

    it('should hydrate malformed raw localStorage text to current definitions and empty custom mappings', async () => {
        window.localStorage.setItem(STORAGE_KEY, '{not valid superjson');

        const state = await importFreshShortcutStore();

        expect(state?.definitions.some((definition) => definition.id === 'transport.togglePlayback')).toBe(true);
        expect(state?.customMappings).toEqual({});
    });
});
