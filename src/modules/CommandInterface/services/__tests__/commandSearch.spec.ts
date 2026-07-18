import { describe, it, expect } from 'vitest';

import { type CommandEntry } from '../../models/CommandEntry';
import { fuzzyMatch, searchCommands } from '../commandSearch';

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
});
