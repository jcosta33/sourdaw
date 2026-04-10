import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getTrackStoreState } from './getTrackStoreState';

describe('getTrackStoreState', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns injected store value', () => {
        const snapshot = { tracks: [], selectedTrackId: null };
        injectDependencies(getTrackStoreState, {
            trackStore: {
                value: snapshot,
                set: () => {},
            } as never,
        });
        expect(getTrackStoreState()).toBe(snapshot);
    });
});
