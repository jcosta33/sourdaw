import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { flattenComp } from './flattenComp';

describe('flattenComp', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('no-ops when store is empty', () => {
        const set = vi.fn();
        injectDependencies(flattenComp, {
            takeLaneStore: {
                value: null,
                set,
            } as never,
        });
        flattenComp('t1');
        expect(set).not.toHaveBeenCalled();
    });

    it('removes the lane for the track', () => {
        const laneA = createTakeLane('t1');
        const laneB = createTakeLane('t2');
        const set = vi.fn();
        injectDependencies(flattenComp, {
            takeLaneStore: {
                value: { lanes: [laneA, laneB] },
                set,
            } as never,
        });
        flattenComp('t1');
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
        expect(next.lanes[0]).toEqual(laneB);
    });
});
