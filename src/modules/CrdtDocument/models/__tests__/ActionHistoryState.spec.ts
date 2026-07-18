import { describe, it, expect } from 'vitest';

import {
    type ActionHistoryEntry,
    defaultActionHistoryState,
    sanitize_action_history_state,
    normalize_action_history_state,
} from '../ActionHistoryState';

const make_entry = (id: string, overrides: Partial<ActionHistoryEntry> = {}): ActionHistoryEntry => ({
    id,
    label: `Action ${id}`,
    actionKind: 'addTrack',
    source: 'manual',
    timestamp: Date.now(),
    reverted: false,
    ...overrides,
});

describe('defaultActionHistoryState', () => {
    it('has empty entries array', () => {
        expect(defaultActionHistoryState.entries).toEqual([]);
    });
});

describe('sanitize_action_history_state', () => {
    it('returns valid state unchanged', () => {
        const state = { entries: [make_entry('1')] };
        expect(sanitize_action_history_state(state)).toEqual(state);
    });

    it('normalizes null to default', () => {
        expect(sanitize_action_history_state(null)).toEqual(defaultActionHistoryState);
    });

    it('normalizes undefined to default', () => {
        expect(sanitize_action_history_state(undefined)).toEqual(defaultActionHistoryState);
    });

    it('normalizes missing entries to default', () => {
        expect(sanitize_action_history_state({})).toEqual(defaultActionHistoryState);
    });

    it('filters entries with invalid source', () => {
        const state = {
            entries: [make_entry('1'), { ...make_entry('2'), source: 'invalid' as never }],
        };
        const result = sanitize_action_history_state(state);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]!.id).toBe('1');
    });

    it('filters entries with non-string id', () => {
        const state = { entries: [make_entry('1'), { ...make_entry('2'), id: 123 as never }] };
        const result = sanitize_action_history_state(state);
        expect(result.entries).toHaveLength(1);
    });

    it('filters entries with non-finite timestamp', () => {
        const state = { entries: [make_entry('1'), { ...make_entry('2'), timestamp: Infinity }] };
        const result = sanitize_action_history_state(state);
        expect(result.entries).toHaveLength(1);
    });

    it('preserves optional groupId and groupLabel', () => {
        const state = { entries: [make_entry('1', { groupId: 'g1', groupLabel: 'Group 1' })] };
        const result = sanitize_action_history_state(state);
        expect(result.entries[0]!.groupId).toBe('g1');
        expect(result.entries[0]!.groupLabel).toBe('Group 1');
    });

    it('caps at MAX_HISTORY entries', () => {
        const entries = Array.from({ length: 250 }, (_, i) => make_entry(String(i)));
        const state = { entries };
        const result = sanitize_action_history_state(state);
        expect(result.entries.length).toBeLessThanOrEqual(200);
    });
});

describe('normalize_action_history_state', () => {
    it('handles empty entries array', () => {
        expect(normalize_action_history_state({ entries: [] })).toEqual({ entries: [] });
    });

    it('handles non-array entries', () => {
        expect(normalize_action_history_state({ entries: 'not array' })).toEqual(defaultActionHistoryState);
    });

    it('handles non-object input', () => {
        expect(normalize_action_history_state(42)).toEqual(defaultActionHistoryState);
        expect(normalize_action_history_state('str')).toEqual(defaultActionHistoryState);
    });
});
