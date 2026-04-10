import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { getSetlistProgress } from './getSetlistProgress';

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

describe('getSetlistProgress', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns zeros for empty list', () => {
        injectDependencies(getSetlistProgress, {
            setlistStore: { value: emptySetlist(), set: vi.fn() } as never,
        });
        expect(getSetlistProgress()).toEqual({ current: 0, total: 0, percent: 0 });
    });
});
