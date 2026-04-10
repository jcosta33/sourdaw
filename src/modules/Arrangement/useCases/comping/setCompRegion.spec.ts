import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { setCompRegion } from './setCompRegion';

describe('setCompRegion', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('no-ops when lane store is empty', () => {
        const set = vi.fn();
        injectDependencies(setCompRegion, {
            takeLaneStore: {
                value: null,
                set,
            } as never,
        });
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(set).not.toHaveBeenCalled();
    });

    it('appends a comp region for the matching track lane', () => {
        const lane = createTakeLane('t1');
        const set = vi.fn();
        injectDependencies(setCompRegion, {
            takeLaneStore: {
                value: { lanes: [lane] },
                set,
            } as never,
        });
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { lanes: typeof lane[] };
        expect(next.lanes[0]!.activeCompRegions).toHaveLength(1);
        expect(next.lanes[0]!.activeCompRegions[0]).toEqual({ startBeat: 0, endBeat: 4, takeId: 'take-a' });
    });
});
