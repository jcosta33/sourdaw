import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordToTreeMock } = vi.hoisted(() => ({
    recordToTreeMock: vi.fn(),
}));

vi.mock('../undoTree/recordToTree', () => ({
    recordToTree: recordToTreeMock,
}));

// Import after mocks so the SUT binds to them.
import { undoStore } from '../../stores/undoStore';
import { createUndoEntry } from '../commandQueries';
import { commitUndoEntry } from '../commitUndoEntry';

describe('commitUndoEntry', () => {
    beforeEach(() => {
        recordToTreeMock.mockClear();
        undoStore.set({ past: [], future: [] });
    });

    it('appends the entry to the undo store and mirrors it into the tree', () => {
        const existing = createUndoEntry('existing', { type: 'togglePlayback' }, { type: 'toggleRecording' });
        const future = createUndoEntry('future', { type: 'toggleLoop' }, { type: 'stopPlayback' });
        const entry = createUndoEntry(
            'commit',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );
        undoStore.set({ past: [existing], future: [future] });

        commitUndoEntry(entry);

        expect(undoStore.value).toEqual({
            past: [existing, entry],
            future: [],
        });
        expect(recordToTreeMock).toHaveBeenCalledTimes(1);
        expect(recordToTreeMock).toHaveBeenCalledWith(entry);
    });
});
