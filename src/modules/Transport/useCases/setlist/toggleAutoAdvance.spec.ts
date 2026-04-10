import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { toggleAutoAdvance } from './toggleAutoAdvance';

function emptySetlist(overrides: Partial<SetlistState> = {}): SetlistState {
    return {
        name: 'Test',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        totalDuration: 0,
        ...overrides,
    };
}

describe('toggleAutoAdvance', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips autoAdvance', () => {
        const set = vi.fn();
        injectDependencies(toggleAutoAdvance, {
            setlistStore: { value: { ...emptySetlist(), autoAdvance: false }, set } as never,
        });
        toggleAutoAdvance();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ autoAdvance: true }));
    });
});
