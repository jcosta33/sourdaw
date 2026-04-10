import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { getTakeLaneForTrack } from './getTakeLaneForTrack';

describe('getTakeLaneForTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when store is empty', () => {
        injectDependencies(getTakeLaneForTrack, {
            takeLaneStore: {
                value: null,
                set: () => {},
            } as never,
        });
        expect(getTakeLaneForTrack('t1')).toBeNull();
    });

    it('returns the lane for the track id', () => {
        const lane = createTakeLane('t1');
        injectDependencies(getTakeLaneForTrack, {
            takeLaneStore: {
                value: { lanes: [lane] },
                set: () => {},
            } as never,
        });
        expect(getTakeLaneForTrack('t1')).toEqual(lane);
        expect(getTakeLaneForTrack('missing')).toBeNull();
    });
});
