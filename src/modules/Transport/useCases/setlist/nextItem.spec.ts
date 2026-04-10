import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { nextItem } from './nextItem';

describe('nextItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('calls goToItem with currentIndex + 1', () => {
        const goToItem = vi.fn();
        injectDependencies(nextItem, {
            setlistStore: {
                value: {
                    name: 'S',
                    items: [{ id: 'a', name: 'A', projectPath: null, bpm: null, timeSignature: null, estimatedDuration: 1, notes: '', programChange: null, color: '#000', autoStop: true, gapSeconds: 0, markers: [] }],
                    currentIndex: 0,
                    autoAdvance: false,
                    countInBars: 1,
                    totalDuration: 1,
                } as SetlistState,
                set: vi.fn(),
            } as never,
            goToItem,
        });
        nextItem();
        expect(goToItem).toHaveBeenCalledWith(1);
    });
});
