import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    claimActionReplayCapability as claimStoredActionReplayCapability,
    clearActionReplayCapabilities,
    hasActionReplayCapability,
    hasActionReplayMarkReconciliation,
    registerActionReplayCapability as registerStoredActionReplayCapability,
    retainActionReplayMarkReconciliation,
} from '../../stores/actionReplayCapabilities';
import { undoStore, pushUndo } from '../../stores/undoStore';
import { clearActionHistory } from '../clearActionHistory';

import type { CallbackUndoEntry } from '../commandQueries';

const mocks = vi.hoisted(() => ({
    clear_metadata: vi.fn<() => void>(),
}));

type TestInverseAction = Parameters<typeof registerStoredActionReplayCapability>[0]['inverseAction'];

function create_metadata(entry_id: string) {
    return {
        id: entry_id,
        label: `Action ${entry_id}`,
        actionKind: 'testAction',
        source: 'manual' as const,
        timestamp: 10,
    };
}

function registerActionReplayCapability(input: { entryId: string; inverseAction: TestInverseAction }): void {
    registerStoredActionReplayCapability({ ...input, metadata: create_metadata(input.entryId) });
}

function claimActionReplayCapability(entry_id: string) {
    return claimStoredActionReplayCapability({ entryId: entry_id, metadata: create_metadata(entry_id) });
}

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

    it('should prevent a project-A inverse from being claimed after project-B transition reset', () => {
        registerActionReplayCapability({ entryId: 'project-a-entry', inverseAction: { type: 'togglePlayback' } });

        clearActionHistory();

        expect(claimActionReplayCapability('project-a-entry')).toBeNull();
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
