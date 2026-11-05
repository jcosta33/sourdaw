import { describe, expect, it } from 'vitest';

import { isDefaultTrackName, nextDefaultTrackName } from '../DefaultTrackName';

describe('nextDefaultTrackName', () => {
    it.each([
        ['an empty project', [], 'MIDI 1'],
        ['tracks of another kind only', [{ kind: 'audio', name: 'Audio 4' }], 'MIDI 1'],
        [
            'unsorted numbers of the kind',
            [
                { kind: 'midi', name: 'MIDI 2' },
                { kind: 'midi', name: 'MIDI 7' },
                { kind: 'midi', name: 'MIDI 3' },
            ],
            'MIDI 8',
        ],
        ['a bare label, counted as the first', [{ kind: 'midi', name: 'MIDI' }], 'MIDI 2'],
        [
            'user names and default names of another kind',
            [
                { kind: 'midi', name: 'Lead' },
                { kind: 'midi', name: 'MIDI 2 copy' },
                { kind: 'audio', name: 'MIDI 9' },
                { kind: 'midi', name: 'Audio 5' },
            ],
            'MIDI 1',
        ],
    ] as const)('names a MIDI track after %s', (_case, tracks, expected) => {
        expect(nextDefaultTrackName('midi', tracks)).toBe(expected);
    });

    it.each([
        ['audio', 'Audio 1'],
        ['midi', 'MIDI 1'],
        ['bus', 'Bus 1'],
        ['folder', 'Folder 1'],
        ['master', 'Master 1'],
    ] as const)('labels a %s track as the app shows its kind', (kind, expected) => {
        expect(nextDefaultTrackName(kind, [])).toBe(expected);
    });
});

describe('isDefaultTrackName', () => {
    it.each(['MIDI', 'MIDI 12', 'Audio 3', 'Bus 1', 'Folder', 'Master 2'])('recognises %s', (name) => {
        expect(isDefaultTrackName(name)).toBe(true);
    });

    it.each(['Lead', 'MIDI 2 copy', 'midi 2', 'Audio-3', 'Bass Bus 1', ''])('rejects %s', (name) => {
        expect(isDefaultTrackName(name)).toBe(false);
    });
});
