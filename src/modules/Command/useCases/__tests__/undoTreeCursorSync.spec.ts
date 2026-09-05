import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { type ActionUndoEntry, type CallbackUndoEntry, type UndoEntry } from '../../models/UndoEntry';
import { createEmptyTree } from '../../models/UndoTree';
import { undoTreeStore } from '../../stores/undoTree';
import { redo } from '../redo';
import { REDO_NOT_APPLIED } from '../redoResult';
import { undo } from '../undo';
import { recordToTree } from '../undoTree/recordToTree';

import type { UndoStoreState } from '../../stores/undoStore';

/**
 * #3640 — the undo tree's `currentNodeId` is a presentation mirror of where the
 * document is. The undo/redo scans skip and drop entries (inert purges, conflicts
 * retained for retry, not-applied redo entries), and every such transition must
 * leave the cursor naming the entry whose state the document actually holds — or
 * `null` at the root — without changing any undo/redo document semantics.
 *
 * The engine specs (undo.spec, undoRedoReplayConflicts.spec) mock `undoTreeMoveTo`,
 * so they only pin that a move was requested. These tests run the REAL mover
 * against the REAL `undoTreeStore` and pin the composed invariant: the cursor
 * position the user's tree actually ends up on.
 */

const mocks = vi.hoisted(() => {
    const undoStoreValue: { value: UndoStoreState | null } = {
        value: { past: [], future: [] },
    };
    return {
        undoStoreValue,
        undoStoreSet: vi.fn<(state: UndoStoreState) => void>(),
        executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
        notifyUser: vi.fn<(message: string, level?: string) => void>(),
    };
});

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: mocks.undoStoreSet,
    },
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

function undoableEntry(id: string): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
    };
}

/** Undoing writes nothing by construction: the entry is dropped, never retried. */
function inertEntry(id: string): ActionUndoEntry {
    return { ...undoableEntry(id), inverseAction: null };
}

function notAppliedCallbackEntry(id: string): CallbackUndoEntry {
    return {
        kind: 'callback',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        undo: () => undefined,
        redo: () => REDO_NOT_APPLIED,
    };
}

/** Commit entries through the real mirror so the tree holds real nodes and the
 *  cursor sits on the last-pushed entry, exactly as a live session would. */
function recordPast(...entries: readonly UndoEntry[]): void {
    for (const entry of entries) {
        recordToTree(entry);
    }
}

function nodeIdForEntry(entryId: string): string {
    const tree = undoTreeStore.value?.tree;
    const nodeId = tree && Object.keys(tree.nodes).find((id) => tree.nodes[id]!.entry.id === entryId);
    if (!nodeId) {
        throw new Error(`No tree node was recorded for entry "${entryId}"`);
    }
    return nodeId;
}

function currentNodeId(): string | null {
    const state = undoTreeStore.value;
    if (!state) {
        throw new Error('undoTreeStore lost its value');
    }
    return state.tree.currentNodeId;
}

function settledUndoState(): UndoStoreState {
    const state = mocks.undoStoreValue.value;
    if (!state) {
        throw new Error('undo/redo left no undo state behind');
    }
    return state;
}

describe('undo/redo keeps the tree cursor on the document position (#3640)', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        mocks.undoStoreSet.mockReset();
        mocks.undoStoreSet.mockImplementation((state) => {
            mocks.undoStoreValue.value = state;
        });
        mocks.executeAppAction.mockReset();
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.notifyUser.mockReset();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    describe('undo', () => {
        it('keeps the cursor on the conflicted head when an inert purge precedes the conflict', async () => {
            const conflicted = undoableEntry('conflict-1');
            const inert = inertEntry('inert-1');
            recordPast(conflicted, inert);
            mocks.undoStoreValue.value = { past: [conflicted, inert], future: [] };
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('toggleRecording'));

            // `headConsumed` speaks of the entry that headed `past` when the call
            // began — the inert one — and the purge did consume it.
            await expect(undo()).resolves.toEqual({ headConsumed: true });

            // The inert entry was purged and the head's inverse wrote nothing, so the
            // document still holds the head's edit: the cursor must stay on it.
            expect(currentNodeId()).toBe(nodeIdForEntry('conflict-1'));
            // The head stays on `past` retryable; only the inert wedge is gone.
            expect(settledUndoState().past.map((entry) => entry.id)).toEqual(['conflict-1']);
            // The mirror never rewrites history: the purged entry keeps its node.
            expect(nodeIdForEntry('inert-1')).toBeTruthy();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        });

        it('leaves the cursor on the retained head when a conflict purges nothing', async () => {
            const older = undoableEntry('older-1');
            const conflicted = undoableEntry('conflict-1');
            recordPast(older, conflicted);
            mocks.undoStoreValue.value = { past: [older, conflicted], future: [] };
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('toggleRecording'));
            const treeBefore = undoTreeStore.value;

            await expect(undo()).resolves.toEqual({ headConsumed: false });

            // Nothing was written and nothing was dropped, so no transition happened at
            // all: the stacks are untouched and the mirror must not move or re-set.
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(undoTreeStore.value).toBe(treeBefore);
            expect(currentNodeId()).toBe(nodeIdForEntry('conflict-1'));
        });

        it('lands the cursor on the entry the document is at after an inert purge and an undo beneath it', async () => {
            const below = undoableEntry('below-1');
            const undone = undoableEntry('undone-1');
            const inert = inertEntry('inert-1');
            recordPast(below, undone, inert);
            mocks.undoStoreValue.value = { past: [below, undone, inert], future: [] };

            await undo();

            // The document is back at `below-1`'s state, so the cursor must name it —
            // not the last-pushed node (the inert entry) and not the undone one.
            expect(currentNodeId()).toBe(nodeIdForEntry('below-1'));
            expect(settledUndoState().past.map((entry) => entry.id)).toEqual(['below-1']);
        });

        it('returns the cursor to the root when an inert purge empties past', async () => {
            const undone = undoableEntry('undone-1');
            const inert = inertEntry('inert-1');
            recordPast(undone, inert);
            mocks.undoStoreValue.value = { past: [undone, inert], future: [] };

            await undo();

            expect(currentNodeId()).toBeNull();
            expect(settledUndoState().past).toEqual([]);
        });
    });

    describe('redo', () => {
        /** Roll the recorded history back through the real undo() so the stack sits
         *  mid-history and the cursor sits on the top of `past` — the state a redo
         *  actually starts from. */
        async function rolledBackPast(...entries: readonly UndoEntry[]): Promise<void> {
            recordPast(...entries);
            mocks.undoStoreValue.value = { past: [...entries], future: [] };
            for (let index = entries.length - 1; index > 0; index--) {
                await undo();
            }
        }

        it('leaves the cursor on the current entry when a redo conflicts and purges nothing', async () => {
            const current = undoableEntry('current-1');
            const redoable = undoableEntry('redo-1');
            await rolledBackPast(current, redoable);
            mocks.undoStoreSet.mockClear();
            const treeBefore = undoTreeStore.value;
            mocks.executeAppAction.mockRejectedValue(new AppActionConflictError('togglePlayback'));

            await expect(redo()).resolves.toBeUndefined();

            // The document did not move, so neither may the cursor.
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(undoTreeStore.value).toBe(treeBefore);
            expect(currentNodeId()).toBe(nodeIdForEntry('current-1'));
        });

        it('keeps the cursor in place when a not-applied redo entry is purged', async () => {
            const current = undoableEntry('current-1');
            const dead = notAppliedCallbackEntry('dead-1');
            await rolledBackPast(current, dead);
            const treeBefore = undoTreeStore.value;

            await expect(redo()).resolves.toBeUndefined();

            // The dead entry was purged from `future`, but `past` did not move, so the
            // cursor stays where it was — and the no-op move must not re-set the tree.
            expect(settledUndoState().future).toEqual([]);
            expect(undoTreeStore.value).toBe(treeBefore);
            expect(currentNodeId()).toBe(nodeIdForEntry('current-1'));
        });

        it('advances the cursor to the entry a redo applies after dropping a not-applied one', async () => {
            const current = undoableEntry('current-1');
            const dead = notAppliedCallbackEntry('dead-1');
            const redone = undoableEntry('redone-1');
            await rolledBackPast(current, dead, redone);

            await expect(redo()).resolves.toBeUndefined();

            // The document advanced to `redone-1`'s state (the dead entry wrote
            // nothing), so the cursor must advance with it.
            expect(currentNodeId()).toBe(nodeIdForEntry('redone-1'));
            expect(settledUndoState().past.map((entry) => entry.id)).toEqual(['current-1', 'redone-1']);
        });
    });
});
