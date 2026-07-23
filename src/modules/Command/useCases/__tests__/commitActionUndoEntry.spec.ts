import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { commitActionUndoEntry } from '../commitActionUndoEntry';
import { commitUndoEntry } from '../commitUndoEntry';
import { createUndoEntry } from '../createUndoEntry';

import type { AppAction } from '#/utils/handlerContract';

vi.mock('../commitUndoEntry', () => ({ commitUndoEntry: vi.fn() }));
vi.mock('../createUndoEntry', () => ({ createUndoEntry: vi.fn() }));

const action: AppAction = { type: 'addTrack', payload: { name: 'Test', kind: 'midi' } } as never;
const inverseAction: AppAction = { type: 'removeTrack', payload: { trackId: 't1' } } as never;

function makeEntry(overrides: Partial<ActionUndoEntry> = {}): ActionUndoEntry {
    return {
        id: 'undo-1',
        kind: 'action',
        label: 'Add track',
        action,
        inverseAction: null,
        timestamp: 0,
        source: 'manual',
        ...overrides,
    };
}

describe('commitActionUndoEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates the entry with a default manual source and commits it as-is when no group is given', () => {
        const entry = makeEntry();
        vi.mocked(createUndoEntry).mockReturnValue(entry);

        commitActionUndoEntry({ action, inverseAction, label: 'Add track' });

        expect(createUndoEntry).toHaveBeenCalledWith('Add track', action, inverseAction, 'manual');
        expect(commitUndoEntry).toHaveBeenCalledWith(entry);
        expect(entry.groupId).toBeUndefined();
    });

    it('forwards an explicit source to createUndoEntry', () => {
        const entry = makeEntry();
        vi.mocked(createUndoEntry).mockReturnValue(entry);

        commitActionUndoEntry({ action, inverseAction: null, label: 'Voice edit', source: 'voice' });

        expect(createUndoEntry).toHaveBeenCalledWith('Voice edit', action, null, 'voice');
    });

    it('stamps groupId and groupLabel onto the entry before committing when a group is given', () => {
        const entry = makeEntry();
        vi.mocked(createUndoEntry).mockReturnValue(entry);

        commitActionUndoEntry({
            action,
            inverseAction: null,
            label: 'Batch delete',
            groupId: 'group-1',
            groupLabel: 'Delete tracks',
        });

        expect(entry.groupId).toBe('group-1');
        expect(entry.groupLabel).toBe('Delete tracks');
        expect(commitUndoEntry).toHaveBeenCalledWith(entry);
    });

    it('does not stamp a group when groupId is not provided even if groupLabel is', () => {
        const entry = makeEntry();
        vi.mocked(createUndoEntry).mockReturnValue(entry);

        commitActionUndoEntry({ action, inverseAction: null, label: 'No group', groupLabel: 'Ignored label' });

        expect(entry.groupId).toBeUndefined();
        expect(entry.groupLabel).toBeUndefined();
    });
});
