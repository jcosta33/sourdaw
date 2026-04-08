import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { selectTrack } from './timelineViewActions';

describe('timelineViewActions injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('selectTrack forwards to selectTrackImpl', () => {
        const selectTrackImpl = vi.fn();
        injectDependencies(selectTrack, { selectTrackImpl });

        selectTrack('t1');

        expect(selectTrackImpl).toHaveBeenCalledWith('t1');
    });
});
