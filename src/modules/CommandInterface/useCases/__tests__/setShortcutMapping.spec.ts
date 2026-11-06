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

describe('setShortcutMapping reassignment', () => {
    const reassignState: ShortcutStoreState = {
        definitions: [
            {
                id: 'transport.toggleMetronome',
                label: 'Toggle Metronome',
                category: 'transport',
                defaultKeys: ['m'],
                action: { type: 'appAction', action: { type: 'toggleMetronome' } },
            },
            {
                id: 'transport.toggleLoop',
                label: 'Toggle Loop',
                category: 'transport',
                defaultKeys: ['l'],
                action: { type: 'appAction', action: { type: 'toggleLoop' } },
            },
            {
                id: 'workspace.toggleInspector',
                label: 'Toggle Inspector',
                category: 'view',
                defaultKeys: ['mod+i', 'alt+i'],
                action: { type: 'callback', id: 'toggleInspector' },
            },
            {
                id: 'loopStation.pad.r2c8.play',
                label: 'Loop Station: Play row 3 col 9',
                category: 'transport',
                defaultKeys: ['l'],
                action: { type: 'callback', id: 'loopStationPad.play.r2c8' },
            },
        ],
        customMappings: {},
    };

    beforeEach(() => {
        shortcutStore.set({ definitions: reassignState.definitions, customMappings: {} });
    });

    it('moves the combo off every binding that held it, pads included, leaving them explicitly unbound', () => {
        setShortcutMapping('transport.toggleMetronome', 'l');

        expect(shortcutStore.value?.customMappings).toStrictEqual({
            'transport.toggleMetronome': ['l'],
            'transport.toggleLoop': [],
            'loopStation.pad.r2c8.play': [],
        });
    });

    it('moves a global key onto a play pad, unbinding the global', () => {
        setShortcutMapping('loopStation.pad.r2c8.play', 'mod+i');

        expect(shortcutStore.value?.customMappings).toStrictEqual({
            'loopStation.pad.r2c8.play': ['mod+i'],
            'workspace.toggleInspector': ['alt+i'],
        });
    });

    it('removes only the reassigned combo from a binding that keeps another key', () => {
        setShortcutMapping('transport.toggleMetronome', 'alt+i');

        expect(shortcutStore.value?.customMappings).toStrictEqual({
            'transport.toggleMetronome': ['alt+i'],
            'workspace.toggleInspector': ['mod+i'],
        });
    });
});
