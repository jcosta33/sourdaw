import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { reorderSetlistItems } from './reorderSetlistItems';

const item = (id: string): SetlistItem => ({
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
});

describe('reorderSetlistItems', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('moves item from index 0 to 1', () => {
        const set = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [item('a'), item('b')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };
        injectDependencies(reorderSetlistItems, {
            setlistStore: { value: state, set } as never,
        });
        reorderSetlistItems(0, 1);
        const next = set.mock.calls[0]![0] as SetlistState;
        expect(next.items.map((i) => i.id)).toEqual(['b', 'a']);
    });
});
