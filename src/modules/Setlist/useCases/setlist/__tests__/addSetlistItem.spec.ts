import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SETLIST_ITEM_COLORS } from '../../../repositories/setlistItemIdCounter';
import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { addSetlistItem } from '../addSetlistItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState | ((prev: SetlistState) => SetlistState)) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../../../repositories/setlistItemIdCounter', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../../../repositories/setlistItemIdCounter')>();
    return {
        ...mod,
        getNextSetlistItemId: () => 'new-id',
    };
});

function item(id: string): SetlistItem {
    return {
        id,
        name: id,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 1,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: true,
        gapSeconds: 0,
        markers: [],
    };
}

describe('addSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends the item to the set', () => {
        const state: SetlistState = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };
        mockSetlistStore.value = state;

        addSetlistItem('Song', 60);

        const expectedItem: SetlistItem = {
            id: 'new-id',
            name: 'Song',
            projectPath: null,
            bpm: null,
            timeSignature: null,
            estimatedDuration: 60,
            notes: '',
            programChange: null,
            color: SETLIST_ITEM_COLORS[0]!,
            autoStop: true,
            gapSeconds: 2,
            markers: [],
        };
        const expectedState: SetlistState = {
            ...state,
            items: [expectedItem],
        };
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expectedState);
    });

    it('does nothing when the store has no value', () => {
        mockSetlistStore.value = null;

        addSetlistItem('Song', 60);

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });

    it('defaults estimatedDuration to 180 seconds when omitted', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };

        addSetlistItem('Encore');

        expect(mockSetlistStore.set).toHaveBeenCalledWith(
            expect.objectContaining({
                items: [expect.objectContaining({ estimatedDuration: 180 })],
            })
        );
    });

    it('cycles item color through the palette by item count, wrapping after 6', () => {
        const sixItems: SetlistItem[] = Array.from({ length: 6 }, (_, index) => item(`item-${index}`));
        mockSetlistStore.value = {
            name: 'S',
            items: sixItems,
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };

        addSetlistItem('Wraps around', 1);

        const call = mockSetlistStore.set.mock.calls[0]![0];
        if (typeof call === 'function') {
            throw new TypeError('expected addSetlistItem to set a plain state object, not an updater function');
        }
        const seventhItem = call.items[6]!;
        expect(seventhItem.color).toBe(SETLIST_ITEM_COLORS[0]);
    });
});
