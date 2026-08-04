import { describe, it, expect } from 'vitest';

import { searchCommandRegistry, type CallableCommandEntry } from '../searchCommandRegistry';

function createEntry(overrides: Partial<CallableCommandEntry>): CallableCommandEntry {
    return {
        id: 'entry',
        label: 'Entry',
        description: 'An entry',
        category: 'Test',
        action: () => {},
        ...overrides,
    };
}

describe('searchCommandRegistry', () => {
    it('offers an entry whose gate reports its resource present', () => {
        const registry = [createEntry({ id: 'gated', label: 'Gated', isAvailable: () => true })];

        expect(searchCommandRegistry({ registry, query: 'Gated' }).map((entry) => entry.id)).toEqual(['gated']);
    });

    it('withholds an entry whose gate reports its resource absent', () => {
        const registry = [createEntry({ id: 'gated', label: 'Gated', isAvailable: () => false })];

        expect(searchCommandRegistry({ registry, query: 'Gated' })).toEqual([]);
    });

    it('withholds an entry whose gate throws, and keeps the rest of the palette alive', () => {
        // This runs in the palette's render body (`CommandPalette.tsx` calls
        // `searchCommands` directly during render), so an unguarded throw does
        // not hide one entry — it unmounts the whole palette, taking every
        // unrelated command with it.
        const registry = [
            createEntry({
                id: 'broken',
                label: 'Broken',
                isAvailable: () => {
                    throw new Error('probe exploded');
                },
            }),
            createEntry({ id: 'healthy', label: 'Broken sibling' }),
        ];

        const results = searchCommandRegistry({ registry, query: 'Broken' });

        expect(results.map((entry) => entry.id)).toEqual(['healthy']);
    });

    it('withholds an entry whose gate returns a promise instead of a boolean', () => {
        // A Promise is truthy. A bare `return entry.isAvailable()` would offer
        // the entry unconditionally — the exact failure this gate exists to
        // prevent, arriving silently through an async gate someone wrote by
        // mistake. Comparing against `true` fails closed instead.
        const asyncGate = (): boolean => Promise.resolve(false) as unknown as boolean;
        const registry = [createEntry({ id: 'async', label: 'Async', isAvailable: asyncGate })];

        expect(searchCommandRegistry({ registry, query: 'Async' })).toEqual([]);
    });

    it('offers an entry that declares no gate at all', () => {
        const registry = [createEntry({ id: 'ungated', label: 'Ungated' })];

        expect(searchCommandRegistry({ registry, query: 'Ungated' }).map((entry) => entry.id)).toEqual(['ungated']);
    });
});
