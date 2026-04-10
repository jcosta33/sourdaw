import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setTrackStoreState } from './setTrackStoreState';

describe('setTrackStoreState', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('delegates to the injected track store set', () => {
        const set = vi.fn();
        const nextState = { tracks: [], selectedTrackId: null as string | null };
        injectDependencies(setTrackStoreState, {
            trackStore: {
                value: { tracks: [], selectedTrackId: null },
                set,
            } as never,
        });

        setTrackStoreState(nextState);

        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(nextState);
    });
});
