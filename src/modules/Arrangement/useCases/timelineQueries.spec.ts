import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getMarkerState } from './timelineQueries';

describe('getMarkerState', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns the injected marker store value', () => {
        const state = { markers: [], sections: [{ id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#000' }] };
        injectDependencies(getMarkerState, {
            markerStore: {
                value: state,
                set: vi.fn(),
            } as never,
        });

        expect(getMarkerState()).toBe(state);
    });

    it('returns null when the store holds null', () => {
        injectDependencies(getMarkerState, {
            markerStore: {
                value: null,
                set: vi.fn(),
            } as never,
        });

        expect(getMarkerState()).toBeNull();
    });
});
