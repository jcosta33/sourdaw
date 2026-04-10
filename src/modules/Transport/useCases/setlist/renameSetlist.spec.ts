import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { renameSetlist } from './renameSetlist';

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

describe('renameSetlist', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('updates name', () => {
        const set = vi.fn();
        injectDependencies(renameSetlist, {
            setlistStore: { value: emptySetlist(), set } as never,
        });
        renameSetlist('Foo');
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ name: 'Foo' }));
    });
});
