import { describe, it, expect, beforeEach } from 'vitest';

import { shortcutStore, type ShortcutStoreState } from '../../stores/shortcutStore';
import { resetShortcutMappings } from '../resetShortcutMappings';
import { setShortcutMapping } from '../setShortcutMapping';

const baseState: ShortcutStoreState = {
    definitions: [
        {
            id: 'editing.undo',
            label: 'Undo',
            category: 'editing',
            defaultKeys: ['mod+z'],
            action: { type: 'callback', id: 'undo' },
        },
    ],
    customMappings: { 'editing.undo': ['mod+z'] },
};

describe('setShortcutMapping', () => {
    beforeEach(() => {
        shortcutStore.set({ definitions: baseState.definitions, customMappings: { ...baseState.customMappings } });
    });

    it('sets the custom combo for a definition while keeping the definitions list', () => {
        setShortcutMapping('editing.undo', 'mod+y');

        expect(shortcutStore.value).toEqual({
            definitions: baseState.definitions,
            customMappings: { 'editing.undo': ['mod+y'] },
        });
    });

    it('adds a new mapping without dropping existing ones', () => {
        setShortcutMapping('transport.play', 'Space');

        expect(shortcutStore.value?.customMappings).toEqual({
            'editing.undo': ['mod+z'],
            'transport.play': ['Space'],
        });
    });
});

describe('resetShortcutMappings', () => {
    beforeEach(() => {
        shortcutStore.set({ definitions: baseState.definitions, customMappings: { ...baseState.customMappings } });
    });

    it('clears every custom mapping but preserves the definitions', () => {
        resetShortcutMappings();

        expect(shortcutStore.value).toEqual({
            definitions: baseState.definitions,
            customMappings: {},
        });
    });
});
