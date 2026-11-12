import { describe, it, expect } from 'vitest';

import { type CommandEntry } from '../../models/CommandEntry';
import { discoverCommands, fuzzyMatch, searchCommands, updateRecentCommandIds } from '../CommandSearch';

type TestCommandEntry = CommandEntry<() => void>;

function entry(overrides: Partial<TestCommandEntry>): TestCommandEntry {
    return {
        id: 'id',
        label: 'Label',
        description: 'Description',
        category: 'Category',
        action: () => {},
        ...overrides,
    };
}

describe('fuzzyMatch', () => {
    it('should return true only when every query character appears in order in the text', () => {
        expect(fuzzyMatch('abc', 'aXbXc')).toBe(true);
        expect(fuzzyMatch('abc', 'cba')).toBe(false);
        expect(fuzzyMatch('foo', 'fuzzy food')).toBe(true);
    });

    it('should be case-insensitive', () => {
        expect(fuzzyMatch('Ab', 'aabb')).toBe(true);
    });

    it('should return true for an empty query', () => {
        expect(fuzzyMatch('', 'anything')).toBe(true);
    });
});

describe('searchCommands', () => {
    const registry: TestCommandEntry[] = [
        entry({ id: '1', label: 'Add Track', description: 'Create a track', category: 'Track' }),
        entry({ id: '2', label: 'Export', description: 'Save project', category: 'Project' }),
    ];

    it('should return the full registry when the query is empty or whitespace-only', () => {
        expect(searchCommands(registry, '')).toBe(registry);
        expect(searchCommands(registry, '   ')).toBe(registry);
    });

    it('should match against label, description, or category', () => {
        expect(searchCommands(registry, 'add')).toHaveLength(1);
        expect(searchCommands(registry, 'add')[0]!.id).toBe('1');

        expect(searchCommands(registry, 'save')).toHaveLength(1);
        expect(searchCommands(registry, 'save')[0]!.id).toBe('2');

        expect(searchCommands(registry, 'proj')).toHaveLength(1);
        expect(searchCommands(registry, 'proj')[0]!.id).toBe('2');
    });

    it('should return an empty array when nothing matches', () => {
        expect(searchCommands(registry, 'zzzz')).toEqual([]);
    });

    it('ranks label matches above broad fuzzy description matches', () => {
        const quantizeRegistry = [
            entry({
                id: 'analyze',
                label: 'Analyze Mix',
                description: 'Run frequency and level analysis on the mix',
                category: 'AI',
            }),
            entry({ id: 'elastic', label: 'Elastic: Quantize Selected Clip', description: 'Quantize audio' }),
            entry({ id: 'notes', label: 'Quantize Notes', description: 'Quantize MIDI notes' }),
            entry({ id: 'audio', label: 'Audio Quantize', description: 'Quantize audio' }),
        ];

        expect(searchCommands(quantizeRegistry, 'quant').map((command) => command.id)).toEqual([
            'notes',
            'elastic',
            'audio',
            'analyze',
        ]);
    });

    it('ranks exact, prefix, substring, description, category, and fuzzy matches in that order', () => {
        const rankedRegistry = [
            entry({ id: 'fuzzy', label: 'Q-U-A-N-T-I-Z-E', description: 'Nothing relevant' }),
            entry({ id: 'category', label: 'Settings', description: 'Nothing relevant', category: 'Quantize' }),
            entry({ id: 'description', label: 'Settings', description: 'Open quantize settings' }),
            entry({ id: 'substring', label: 'Elastic Quantize', description: 'Nothing relevant' }),
            entry({ id: 'prefix', label: 'Quantize Notes', description: 'Nothing relevant' }),
            entry({ id: 'exact', label: 'Quantize', description: 'Nothing relevant' }),
        ];

        expect(searchCommands(rankedRegistry, 'quantize').map((command) => command.id)).toEqual([
            'exact',
            'prefix',
            'substring',
            'description',
            'category',
            'fuzzy',
        ]);
    });
});

describe('command discovery', () => {
    it('moves the latest execution to the front, deduplicates, and evicts the sixth distinct execution', () => {
        const recent = ['a', 'b', 'a', 'c', 'd', 'e', 'f'].reduce(
            (ids, id) => updateRecentCommandIds(ids, id),
            [] as string[]
        );

        expect(recent).toEqual(['f', 'e', 'd', 'c', 'a']);
        expect(recent).toHaveLength(5);
        expect(recent).not.toContain('b');
        expect(updateRecentCommandIds(recent, 'c')).toEqual(['c', 'f', 'e', 'd', 'a']);
    });

    it('groups a small applicable discovery set and orders recents before categories', () => {
        const registry = [
            entry({
                id: 'blocked',
                label: 'Blocked',
                category: 'Clip',
                getInapplicabilityReason: () => 'Select a clip.',
            }),
            entry({ id: 'play', label: 'Play', category: 'Transport' }),
            entry({ id: 'stop', label: 'Stop', category: 'Transport' }),
            entry({ id: 'save', label: 'Save', category: 'Project' }),
        ];

        expect(
            discoverCommands(registry, []).map((group) => [group.label, group.entries.map((command) => command.id)])
        ).toEqual([
            ['Transport', ['play']],
            ['Project', ['save']],
            ['Clip', ['blocked']],
        ]);
        expect(discoverCommands(registry, ['save', 'missing', 'play'])[0]).toMatchObject({
            label: 'Recent',
            entries: [{ id: 'save' }, { id: 'play' }],
        });
    });

    it('caps discovery at eight categories with every applicable command ahead of gated commands', () => {
        const gated = () => 'Select a clip first.';
        const registry = [
            entry({ id: 'gated-clip', category: 'Clip', getInapplicabilityReason: gated }),
            entry({ id: 'play', category: 'Transport' }),
            entry({ id: 'gated-midi', category: 'MIDI', getInapplicabilityReason: gated }),
            entry({ id: 'save', category: 'Project' }),
            entry({ id: 'zoom', category: 'View' }),
            entry({ id: 'add-track', category: 'Track' }),
            entry({ id: 'undo', category: 'Edit' }),
            entry({ id: 'automation', category: 'Automation' }),
            entry({ id: 'browser', category: 'Browser' }),
            entry({ id: 'mixer', category: 'Mixer' }),
        ];

        const groups = discoverCommands(registry, []);

        expect(groups).toHaveLength(8);
        expect(groups.map((group) => group.entries[0]!.id)).toEqual([
            'play',
            'save',
            'zoom',
            'add-track',
            'undo',
            'automation',
            'browser',
            'mixer',
        ]);
    });
});
