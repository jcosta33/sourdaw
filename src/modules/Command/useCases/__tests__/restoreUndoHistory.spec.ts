import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { type UndoTree, type UndoTreeNode, createEmptyTree } from '../../models/UndoTree';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { captureUndoHistory, type UndoHistorySnapshot } from '../captureUndoHistory';
import { clearUndoHistory } from '../clearUndoHistory';
import { createUndoEntry } from '../createUndoEntry';
import { restoreUndoHistory } from '../restoreUndoHistory';
import { rebuildTreeFromPast } from '../undoTree/rebuildTreeFromPast';
import { recordToTree } from '../undoTree/recordToTree';
import { undoTreeMoveTo } from '../undoTree/undoTreeMoveTo';

type TreeMirrorShape = {
    currentNodeId: string | null;
    nextId: number;
    nodeIds: string[];
    nodes: Record<string, Omit<UndoTreeNode, 'createdAt'>>;
};

/**
 * The mirror's structural identity, minus `createdAt` — the one field
 * `pushToTree` takes from the wall clock, so two rebuilds of the same `past`
 * can never compare equal whole.
 */
function treeMirrorShape(tree: UndoTree): TreeMirrorShape {
    const nodes = Object.entries(tree.nodes).map(([nodeId, node]): [string, Omit<UndoTreeNode, 'createdAt'>] => [
        nodeId,
        {
            id: node.id,
            entry: node.entry,
            parentId: node.parentId,
            children: node.children,
            activeBranch: node.activeBranch,
        },
    ]);
    return {
        currentNodeId: tree.currentNodeId,
        nextId: tree.nextId,
        nodeIds: Object.keys(tree.nodes),
        nodes: Object.fromEntries(nodes),
    };
}

describe('restoreUndoHistory', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        undoStore.set({ past: [], future: [] });
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
    });

    it('sets the undo store back to the captured state, action data included', () => {
        const action: AppAction = { type: 'addTrack', payload: { name: 'Test', kind: 'midi' } };
        const inverseAction: AppAction = { type: 'removeTrack', payload: { trackId: 't1' } };
        const entry: ActionUndoEntry = {
            id: 'undo-1',
            kind: 'action',
            label: 'Move clip',
            action,
            inverseAction,
            timestamp: 1,
            source: 'manual',
        };
        const captured: UndoHistorySnapshot = { past: [entry], future: [], undoTree: null };
        const setSpy = vi.spyOn(undoStore, 'set');

        restoreUndoHistory(captured);

        expect(setSpy).toHaveBeenCalledWith(captured);
    });

    it('restores the captured mirror wholesale, keeping future nodes and the cursor', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        const e1 = createUndoEntry('Add notes', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const e2 = createUndoEntry('Move clip', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        const e3 = createUndoEntry('Delete clip', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        undoStore.set({ past: [e1, e2, e3], future: [] });
        recordToTree(e1);
        recordToTree(e2);
        recordToTree(e3);
        // Production undo: e3 moves to `future` and the tree cursor walks back to e2.
        undoStore.set({ past: [e1, e2], future: [e3] });
        undoTreeMoveTo(e2.id);

        // Snapshot exactly as switchBranch does before a transition it may have to roll back.
        const snapshot = captureUndoHistory();
        const capturedCursor = snapshot.undoTree?.tree.currentNodeId;
        expect(capturedCursor).not.toBeNull();

        // The failed transition cleared the stacks and emptied the mirror with them.
        clearUndoHistory();
        expect(undoTreeStore.value?.tree).toEqual(createEmptyTree());

        restoreUndoHistory(snapshot);

        // The mirror holds nodes for the past AND the redo future segment.
        const tree = undoTreeStore.value!.tree;
        const restoredEntryIds = Object.values(tree.nodes).map((node) => node.entry.id);
        expect(restoredEntryIds).toContain(e1.id);
        expect(restoredEntryIds).toContain(e2.id);
        expect(restoredEntryIds).toContain(e3.id);
        // The cursor stands where the user stood at capture, not at the newest node.
        expect(tree.currentNodeId).toBe(capturedCursor);
        expect(undoTreeStore.value?.enabled).toBe(true);
    });

    it('rebuilds the tree mirror from the restored past when the snapshot carries no mirror state', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        const e1 = createUndoEntry('Add notes', { type: 'togglePlayback' }, { type: 'stopPlayback' });
        const e2 = createUndoEntry('Move clip', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        undoStore.set({ past: [e1, e2], future: [] });
        recordToTree(e1);
        recordToTree(e2);
        // A snapshot with no mirror state: only the stacks can be restored, so the
        // mirror must be re-derived from the restored `past` (past-only: the redo
        // segment's nodes and any mirror-only state are unrecoverable here).
        const snapshot: UndoHistorySnapshot = { ...captureUndoHistory(), undoTree: null };

        // The failed transition cleared the stacks and emptied the mirror with them.
        clearUndoHistory();
        expect(undoTreeStore.value?.tree).toEqual(createEmptyTree());

        restoreUndoHistory(snapshot);

        expect(treeMirrorShape(undoTreeStore.value!.tree)).toEqual(treeMirrorShape(rebuildTreeFromPast(snapshot.past)));
    });
});
