import { describe, it, expect, beforeEach } from 'vitest';

import { actionHistoryStore, pushActionHistoryEntry, markEntryReverted } from '../actionHistoryStore';

import type { ActionHistoryEntry } from '../../models/ActionHistoryState';

const make_entry = (id: string): ActionHistoryEntry => ({
    id,
    label: `Action ${id}`,
    actionKind: 'addTrack',
    source: 'manual',
    timestamp: Date.now(),
    reverted: false,
});

describe('pushActionHistoryEntry', () => {
    beforeEach(() => {
        actionHistoryStore.set({ entries: [] });
    });

    it('adds entry to store', () => {
        const entry = make_entry('e1');
        const evicted = pushActionHistoryEntry(entry);
        expect(evicted).toEqual([]);
        expect(actionHistoryStore.value!.entries).toHaveLength(1);
        expect(actionHistoryStore.value!.entries[0]).toBe(entry);
    });

    it('returns evicted entry IDs when over limit', () => {
        const entries = Array.from({ length: 200 }, (_, i) => make_entry(`e${i}`));
        actionHistoryStore.set({ entries });
        const evicted = pushActionHistoryEntry(make_entry('new'));
        expect(evicted).toHaveLength(1);
        expect(evicted[0]).toBe('e0');
        expect(actionHistoryStore.value!.entries).toHaveLength(200);
    });

    it('appends in order', () => {
        pushActionHistoryEntry(make_entry('a'));
        pushActionHistoryEntry(make_entry('b'));
        pushActionHistoryEntry(make_entry('c'));
        const ids = actionHistoryStore.value!.entries.map((e) => e.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });
});

describe('markEntryReverted', () => {
    beforeEach(() => {
        actionHistoryStore.set({ entries: [] });
    });

    it('marks entry as reverted with correct fingerprint', () => {
        const entry = make_entry('e1');
        pushActionHistoryEntry(entry);
        const fingerprint = JSON.stringify([
            entry.id,
            entry.label,
            entry.actionKind,
            entry.source,
            entry.timestamp,
            null,
            null,
        ]);
        const result = markEntryReverted({ entryId: 'e1', expectedFingerprint: fingerprint });
        expect(result).toEqual({ status: 'marked' });
        expect(actionHistoryStore.value!.entries[0]!.reverted).toBe(true);
    });

    it('returns unavailable for unknown entry', () => {
        const result = markEntryReverted({ entryId: 'nonexistent', expectedFingerprint: '' });
        expect(result).toEqual({ status: 'unavailable' });
    });

    it('returns unavailable for wrong fingerprint', () => {
        const entry = make_entry('e1');
        pushActionHistoryEntry(entry);
        const result = markEntryReverted({ entryId: 'e1', expectedFingerprint: 'wrong' });
        expect(result).toEqual({ status: 'unavailable' });
        expect(actionHistoryStore.value!.entries[0]!.reverted).toBe(false);
    });
});
