import { describe, it, expect, vi, beforeEach } from 'vitest';
import { undo, redo } from '../undoRedo';

const mocks = vi.hoisted(() => ({
    undoStoreValue: { value: { past: [], future: [] } },
    undoStoreSet: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('../stores/undoStore', () => ({
    undoStore: {
        get value() { return mocks.undoStoreValue.value; },
        set: mocks.undoStoreSet,
    }
}));

// Mock executeAppAction from the relative path as used in undoRedo.ts,
// but using a factory that returns our shared mock.
vi.mock('../useCases/executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('undoRedo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    describe('undo', () => {
        it('executes inverseAction and moves entry to future', async () => {
            const entry = { type: 'action', action: { type: 'A' }, inverseAction: { type: 'B' }, label: 'Test' };
            mocks.undoStoreValue.value = { past: [entry], future: [] } as any;

            await undo();

            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'B' });
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [],
                future: [entry],
            });
        });

        it('undoes a whole group if groupId is present', async () => {
            const e1 = { id: '1', action: { type: 'A' }, inverseAction: { type: 'A_INV' }, groupId: 'g1' };
            const e2 = { id: '2', action: { type: 'B' }, inverseAction: { type: 'B_INV' }, groupId: 'g1' };
            mocks.undoStoreValue.value = { past: [e1, e2], future: [] } as any;

            await undo();

            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(1, { type: 'B_INV' });
            expect(mocks.executeAppAction).toHaveBeenNthCalledWith(2, { type: 'A_INV' });

            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [],
                future: [e1, e2],
            });
        });
    });

    describe('redo', () => {
        it('executes action and moves entry back to past', async () => {
            const entry = { type: 'action', action: { type: 'A' }, inverseAction: { type: 'B' } };
            mocks.undoStoreValue.value = { past: [], future: [entry] } as any;

            await redo();

            expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'A' });
            expect(mocks.undoStoreSet).toHaveBeenCalledWith({
                past: [entry],
                future: [],
            });
        });
    });
});
