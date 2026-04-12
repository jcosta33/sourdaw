import { describe, expect, it } from 'vitest';

import { type ActionHistoryEntry } from '../../../stores/actionHistoryStore';
import { canRevertAction } from '../canRevertAction';

function entry(overrides: Partial<ActionHistoryEntry> = {}): ActionHistoryEntry {
    return {
        id: '1',
        label: 'Test',
        actionKind: 'test',
        action: { type: 'noop' },
        inverseAction: { type: 'inverse' },
        source: 'manual',
        timestamp: 0,
        reverted: false,
        ...overrides,
    };
}

describe('canRevertAction', () => {
    it('returns true when the entry has an inverse and is not reverted', () => {
        expect(canRevertAction(entry())).toBe(true);
    });

    it('returns false when already reverted', () => {
        expect(canRevertAction(entry({ reverted: true }))).toBe(false);
    });

    it('returns false when there is no inverse action', () => {
        expect(canRevertAction(entry({ inverseAction: null }))).toBe(false);
    });
});
