import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { previousItem } from './previousItem';

const oneItem = (id: string): SetlistItem => ({
    id,
    name: 'A',
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

describe('previousItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('calls goToItem with currentIndex - 1', () => {
        const goToItem = vi.fn();
        const state: SetlistState = {
            name: 'S',
            items: [oneItem('a'), oneItem('b')],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };
        injectDependencies(previousItem, {
            setlistStore: { value: state, set: vi.fn() } as never,
            goToItem,
        });
        previousItem();
        expect(goToItem).toHaveBeenCalledWith(0);
    });
});
