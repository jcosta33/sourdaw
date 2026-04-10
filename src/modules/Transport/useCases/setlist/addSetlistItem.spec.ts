import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { SETLIST_ITEM_COLORS } from '#/modules/Transport/models/setlistItemHelpers';
import { addSetlistItem } from './addSetlistItem';

describe('addSetlistItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('appends item and updates totalDuration', () => {
        const set = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 0,
        };
        injectDependencies(addSetlistItem, {
            setlistStore: { value: state, set } as never,
            getNextSetlistItemId: () => 'new-id',
            SETLIST_ITEM_COLORS,
        });
        addSetlistItem('Song', 60);
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                items: expect.arrayContaining([expect.objectContaining({ id: 'new-id', name: 'Song' })]),
                totalDuration: 60,
            })
        );
    });
});
