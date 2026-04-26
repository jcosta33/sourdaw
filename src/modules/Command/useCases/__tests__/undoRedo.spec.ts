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

            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'toggleRecording' });
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

            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(1, { type: 'stopPlayback' });
            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(2, { type: 'toggleRecording' });

            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [],
                future: [e1, e2],
            });
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
