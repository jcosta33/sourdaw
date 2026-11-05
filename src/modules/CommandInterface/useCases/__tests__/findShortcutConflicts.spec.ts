import { describe, expect, it } from 'vitest';

import { type ShortcutDefinition, type ShortcutStoreState } from '../../stores/shortcutStore';
import { findShortcutConflicts } from '../findShortcutConflicts';

function definition(id: string, defaultKeys: string[]): ShortcutDefinition {
    return { id, label: id, category: 'transport', defaultKeys, action: { type: 'callback', id } };
}

const state: ShortcutStoreState = {
    definitions: [
        definition('transport.toggleMetronome', ['m']),
        definition('transport.toggleLoop', ['l']),
        definition('arrangement.addAudioTrack', ['shift+n']),
        definition('workspace.toggleInspector', ['mod+i', 'alt+i']),
        definition('loopStation.pad.r1c3.play', ['r']),
        definition('loopStation.pad.r1c3.record', ['shift+r']),
        definition('loopStation.pad.r3c5.record', ['shift+n']),
        definition('loopStation.pad.r3c6.play', ['m']),
    ],
    customMappings: { 'transport.toggleLoop': ['mod+shift+l'] },
};

function conflictIds(definitionId: string, combo: string): string[] {
    return findShortcutConflicts(state, definitionId, combo).map((holder) => holder.id);
}

describe('findShortcutConflicts', () => {
    it.each([
        ['a global against a global', 'transport.toggleMetronome', 'alt+i', ['workspace.toggleInspector']],
        [
            'a global against a record pad and a global',
            'transport.toggleLoop',
            'shift+n',
            ['arrangement.addAudioTrack', 'loopStation.pad.r3c5.record'],
        ],
        ['a play pad against a play pad', 'loopStation.pad.r3c6.play', 'r', ['loopStation.pad.r1c3.play']],
        ['a play pad against a record pad', 'loopStation.pad.r3c6.play', 'shift+r', ['loopStation.pad.r1c3.record']],
        [
            'a key named in another case',
            'transport.toggleLoop',
            'shift+N',
            ['arrangement.addAudioTrack', 'loopStation.pad.r3c5.record'],
        ],
    ])('reports %s', (_label, definitionId, combo, expected) => {
        expect(conflictIds(definitionId, combo)).toStrictEqual(expected);
    });

    it.each([
        ['a global against a play pad, which armed mode overrides', 'transport.toggleLoop', 'r'],
        ['a play pad against a global it overrides', 'loopStation.pad.r1c3.play', 'alt+i'],
        ['a default key the custom mapping replaced', 'transport.toggleMetronome', 'l'],
        ['the definition against its own key', 'transport.toggleMetronome', 'm'],
        ['the same key under different modifiers', 'transport.toggleLoop', 'mod+n'],
    ])('reports no conflict for %s', (_label, definitionId, combo) => {
        expect(conflictIds(definitionId, combo)).toStrictEqual([]);
    });
});
