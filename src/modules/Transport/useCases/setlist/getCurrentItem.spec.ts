import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { getCurrentItem } from './getCurrentItem';

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

describe('getCurrentItem', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when empty', () => {
        injectDependencies(getCurrentItem, {
            setlistStore: { value: emptySetlist(), set: vi.fn() } as never,
        });
        expect(getCurrentItem()).toBeNull();
    });
});
