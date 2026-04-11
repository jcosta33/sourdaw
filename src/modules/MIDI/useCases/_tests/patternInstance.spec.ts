import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getPatternInstances } from '../patternInstance/getPatternInstances';

describe('getPatternInstances', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns an empty list when track state is unavailable', () => {
        const getTrackStoreState = vi.fn().mockReturnValue(null);
        const updateClip = vi.fn();
        const setTrackState = vi.fn();
        const getNotesForClip = vi.fn();
        const setNotesForClip = vi.fn();
        injectDependencies(getPatternInstances, {
            getTrackStoreState,
            updateClip,
            setTrackState,
            getNotesForClip,
            setNotesForClip,
        });

        expect(getPatternInstances('parent')).toEqual([]);
    });
});
