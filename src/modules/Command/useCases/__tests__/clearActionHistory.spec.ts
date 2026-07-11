import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    claimActionReplayCapability,
    clearActionReplayCapabilities,
    hasActionReplayCapability,
    hasActionReplayMarkReconciliation,
    registerActionReplayCapability,
    retainActionReplayMarkReconciliation,
} from '../../stores/actionReplayCapabilities';
import { undoStore, pushUndo } from '../../stores/undoStore';
import { clearActionHistory } from '../clearActionHistory';

import type { CallbackUndoEntry } from '../commandQueries';

const mocks = vi.hoisted(() => ({
    clear_metadata: vi.fn<() => void>(),
}));

vi.mock('../actionHistoryMetadataPort', () => ({
    actionHistoryMetadataPort: {
        record: vi.fn(),
        markReverted: vi.fn(),
        clear: mocks.clear_metadata,
    },
}));

describe('clearActionHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearActionReplayCapabilities();
        undoStore.set({ past: [], future: [] });
    });

    it('should clear display metadata and session capabilities without touching linear undo state', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });

        clearActionHistory();

        expect(mocks.clear_metadata).toHaveBeenCalledTimes(1);
        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should preserve an existing linear undo entry', () => {
        const linear_entry: CallbackUndoEntry = {
            kind: 'callback',
            id: 'linear-entry',
            label: 'Linear action',
            timestamp: 10,
            source: 'manual',
            undo: vi.fn(),
            redo: vi.fn(),
        };
        pushUndo(linear_entry);

        clearActionHistory();

        expect(undoStore.value?.past).toEqual([linear_entry]);
    });

    it('should invalidate pending mark-only reconciliation state', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });
        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }
        retainActionReplayMarkReconciliation({ entryId: 'entry-1', claim });
        expect(hasActionReplayMarkReconciliation('entry-1')).toBe(true);

        clearActionHistory();

        expect(hasActionReplayMarkReconciliation('entry-1')).toBe(false);
    });
});
