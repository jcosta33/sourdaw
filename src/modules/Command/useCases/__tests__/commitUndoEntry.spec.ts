import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pushUndoMock, recordToTreeMock } = vi.hoisted(() => ({
    pushUndoMock: vi.fn(),
    recordToTreeMock: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    pushUndo: pushUndoMock,
}));

vi.mock('../undoTree/recordToTree', () => ({
    recordToTree: recordToTreeMock,
}));

// Import after mocks so the SUT binds to them.
import { commitUndoEntry } from '../commitUndoEntry';
import { createUndoEntry } from '../commandQueries';

describe('commitUndoEntry', () => {
    beforeEach(() => {
        pushUndoMock.mockClear();
        recordToTreeMock.mockClear();
    });

    it('pushes the entry onto the undo store and mirrors it into the tree', () => {
        const entry = createUndoEntry(
            'commit',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );

        commitUndoEntry(entry);

        expect(pushUndoMock).toHaveBeenCalledTimes(1);
        expect(pushUndoMock).toHaveBeenCalledWith(entry);
        expect(recordToTreeMock).toHaveBeenCalledTimes(1);
        expect(recordToTreeMock).toHaveBeenCalledWith(entry);
    });
});
