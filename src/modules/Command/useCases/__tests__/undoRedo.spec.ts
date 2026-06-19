import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undo, redo } from '../undoRedo';

import type { UndoEntry } from '../commandQueries';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as import('../commandQueries').UndoEntry[],
            future: [] as import('../commandQueries').UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: mocks.undoStoreSet,
    },
}));

// Mock executeAppAction from the relative path as used in undoRedo.ts,
// but using a factory that returns our shared mock.
vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('undoRedo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    describe('undo', () => {
        it('executes inverseAction and moves entry to future', async () => {
            const entry: UndoEntry = {
                kind: 'action',
                id: 'e1',
                label: 'Test',
                timestamp: 0,
                source: 'manual',
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'toggleRecording' },
            };
            mocks.undoStoreValue.value = { past: [entry], future: [] };

            await undo();

            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'toggleRecording' }, { skipUndo: true });
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [],
                future: [entry],
            });
        });

        it('undoes a whole group if groupId is present', async () => {
            const e1: UndoEntry = {
                kind: 'action',
                id: '1',
                label: 'a',
                timestamp: 0,
                source: 'manual',
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'toggleRecording' },
                groupId: 'g1',
            };
            const e2: UndoEntry = {
                kind: 'action',
                id: '2',
                label: 'b',
                timestamp: 0,
                source: 'manual',
                action: { type: 'toggleLoop' },
                inverseAction: { type: 'stopPlayback' },
                groupId: 'g1',
            };
            mocks.undoStoreValue.value = { past: [e1, e2], future: [] };

            await undo();

            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(1, { type: 'stopPlayback' }, { skipUndo: true });
            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(2, { type: 'toggleRecording' }, { skipUndo: true });

            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [],
                future: [e1, e2],
            });
        });

        it('threads skipUndo:true so the replayed inverse does not commit its own undo entry', async () => {
            // Regression for the entry-drop race (audit #6/#10/#45/#47): without
            // skipUndo, the replayed inverse runs the full executeAppAction path and
            // pushes a fresh undo entry mid-undo, corrupting the stacks.
            const entry: UndoEntry = {
                kind: 'action',
                id: 'e1',
                label: 'Test',
                timestamp: 0,
                source: 'manual',
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'toggleRecording' },
            };
            mocks.undoStoreValue.value = { past: [entry], future: [] };

            await undo();

            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            expect(mocks.executeAppAction).toHaveBeenCalledWith(expect.anything(), { skipUndo: true });
        });

        it('serializes overlapping undo() calls so the same entry is not popped twice', async () => {
            // Regression for the in-flight race: two concurrent undo() calls would each
            // read the same `state`, pop the same `lastEntry`, and the second write would
            // clobber the first. With the in-flight guard the second call only runs after
            // the first commits, so it sees the (mock-updated) state and is a no-op here.
            const e1: UndoEntry = {
                kind: 'action',
                id: 'e1',
                label: 'a',
                timestamp: 0,
                source: 'manual',
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'toggleRecording' },
            };
            // Make executeAppAction yield, widening the race window, and have the
            // committed write reflected back into the mocked store so the second call
            // observes the popped state.
            mocks.undoStoreSet.mockImplementation((next) => {
                mocks.undoStoreValue.value = next;
            });
            mocks.executeAppAction.mockImplementation(async () => {
                await Promise.resolve();
            });
            mocks.undoStoreValue.value = { past: [e1], future: [] };

            await Promise.all([undo(), undo()]);

            // Exactly one undo happened: one inverse replay, one stack write. The second
            // call saw an empty `past` and returned without touching the store.
            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            expect(mocks.undoStoreSet).toHaveBeenCalledTimes(1);
            expect(mocks.undoStoreValue.value).toEqual({ past: [], future: [e1] });
        });
    });

    describe('redo', () => {
        it('executes action and moves entry back to past', async () => {
            const entry: UndoEntry = {
                kind: 'action',
                id: 'e1',
                label: 'Test',
                timestamp: 0,
                source: 'manual',
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'toggleRecording' },
            };
            mocks.undoStoreValue.value = { past: [], future: [entry] };

            await redo();

            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'togglePlayback' });
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [entry],
                future: [],
            });
        });
    });
});
