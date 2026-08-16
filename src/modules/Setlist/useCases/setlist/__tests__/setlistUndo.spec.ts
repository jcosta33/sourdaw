import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { addSetlistItem } from '../addSetlistItem';
import { removeSetlistItem } from '../removeSetlistItem';
import { renameSetlist } from '../renameSetlist';
import { reorderSetlistItems } from '../reorderSetlistItems';
import { setCountIn } from '../setCountIn';
import { toggleAutoAdvance } from '../toggleAutoAdvance';
import { updateSetlistItem } from '../updateSetlistItem';

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: pushUndoEntryMock,
}));

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../../../repositories/setlistItemIdCounter', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../../../repositories/setlistItemIdCounter')>();
    return {
        ...mod,
        getNextSetlistItemId: () => 'setlist-new',
    };
});

function baseItem(id: string): SetlistItem {
    return {
        id,
        name: id,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 10,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: true,
        gapSeconds: 0,
        markers: [],
    };
}

function baseState(overrides: Partial<SetlistState> = {}): SetlistState {
    return {
        name: 'Set',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        ...overrides,
    };
}

describe('setlist undo entries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSetlistStore.value = null;
    });

    it('addSetlistItem pushes a labeled undo entry', () => {
        mockSetlistStore.value = baseState();
        addSetlistItem('Opener', 60);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Add setlist item: Opener');
    });

    it('removeSetlistItem only pushes undo when the id exists', () => {
        mockSetlistStore.value = baseState();
        removeSetlistItem('missing');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();

        mockSetlistStore.value = baseState({ items: [baseItem('x')] });
        removeSetlistItem('x');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Remove setlist item: x');
    });

    it('reorderSetlistItems pushes undo when order changes', () => {
        mockSetlistStore.value = baseState({ items: [baseItem('a'), baseItem('b')] });
        reorderSetlistItems(0, 1);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Reorder setlist');
    });

    it('renameSetlist skips undo when name is unchanged', () => {
        mockSetlistStore.value = baseState({ name: 'Set' });
        renameSetlist('Set');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();

        renameSetlist('Fresh');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Rename setlist: Fresh');
    });

    it('updateSetlistItem pushes undo with the item name', () => {
        mockSetlistStore.value = baseState({ items: [baseItem('x')] });
        updateSetlistItem('x', { name: 'Renamed' });
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Update setlist item: x');
    });

    it('setCountIn pushes undo only when the value changes', () => {
        mockSetlistStore.value = baseState({ countInBars: 1 });
        setCountIn(1);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();

        setCountIn(4);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set count-in bars');
    });

    it('toggleAutoAdvance uses the target direction in the label', () => {
        mockSetlistStore.value = baseState({ autoAdvance: false });
        toggleAutoAdvance();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Enable auto-advance');

        pushUndoEntryMock.mockClear();
        mockSetlistStore.value = baseState({ autoAdvance: true });
        toggleAutoAdvance();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Disable auto-advance');
    });

    it('addSetlistItem undo callback reverts store to the previous snapshot', () => {
        const initial = baseState();
        mockSetlistStore.value = initial;
        addSetlistItem('Opener', 60);
        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mockSetlistStore.set).toHaveBeenLastCalledWith(initial);
    });

    it('addSetlistItem redo callback reapplies the item after an undo', () => {
        const initial = baseState();
        mockSetlistStore.value = initial;
        addSetlistItem('Opener', 60);
        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;
        (undoFn as () => void)();
        (redoFn as () => void)();
        const applied = mockSetlistStore.set.mock.calls.at(-1)![0] as SetlistState;
        expect(applied.items.map((entry) => entry.name)).toEqual(['Opener']);
    });

    it('removeSetlistItem undo callback restores the removed item, redo re-removes it', () => {
        const withItem = baseState({ items: [baseItem('x')] });
        mockSetlistStore.value = withItem;
        removeSetlistItem('x');
        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        (undoFn as () => void)();
        expect(mockSetlistStore.set).toHaveBeenLastCalledWith(withItem);

        (redoFn as () => void)();
        const afterRedo = mockSetlistStore.set.mock.calls.at(-1)![0] as SetlistState;
        expect(afterRedo.items).toEqual([]);
    });

    it('reorderSetlistItems undo callback restores original order, redo re-applies the move', () => {
        const original = baseState({ items: [baseItem('a'), baseItem('b')] });
        mockSetlistStore.value = original;
        reorderSetlistItems(0, 1);
        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        (undoFn as () => void)();
        expect(mockSetlistStore.set).toHaveBeenLastCalledWith(original);

        (redoFn as () => void)();
        const afterRedo = mockSetlistStore.set.mock.calls.at(-1)![0] as SetlistState;
        expect(afterRedo.items.map((entry) => entry.id)).toEqual(['b', 'a']);
    });
});
