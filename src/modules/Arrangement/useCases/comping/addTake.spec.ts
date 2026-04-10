import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { addTake } from './addTake';

describe('addTake', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('no-ops when lane store is empty', () => {
        const set = vi.fn();
        injectDependencies(addTake, {
            takeLaneStore: {
                value: null,
                set,
            } as never,
        });
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(set).not.toHaveBeenCalled();
    });

    it('appends a take on the matching lane', () => {
        const lane = createTakeLane('t1');
        const set = vi.fn();
        injectDependencies(addTake, {
            takeLaneStore: {
                value: { lanes: [lane] },
                set,
            } as never,
        });
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { lanes: typeof lane[] };
        expect(next.lanes[0]!.takes).toHaveLength(1);
        expect(next.lanes[0]!.takes[0]!.clipId).toBe('clip-1');
        expect(next.lanes[0]!.takes[0]!.name).toBe('Take 1');
    });
});
