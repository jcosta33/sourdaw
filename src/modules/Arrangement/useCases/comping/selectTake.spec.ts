import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTake, createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { selectTake } from './selectTake';

describe('selectTake', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('no-ops when store is empty', () => {
        const set = vi.fn();
        injectDependencies(selectTake, {
            takeLaneStore: {
                value: null,
                set,
            } as never,
        });
        selectTake('t1', 'take-a');
        expect(set).not.toHaveBeenCalled();
    });

    it('marks the chosen take as selected on the track lane', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        const takeB = createTake('c2', 'B', 0, 4);
        const lane = { ...createTakeLane('t1'), takes: [takeA, takeB] };
        const set = vi.fn();
        injectDependencies(selectTake, {
            takeLaneStore: {
                value: { lanes: [lane] },
                set,
            } as never,
        });
        selectTake('t1', takeB.id);
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { lanes: typeof lane[] };
        const updated = next.lanes[0]!;
        expect(updated.takes.find((t) => t.id === takeA.id)?.selected).toBe(false);
        expect(updated.takes.find((t) => t.id === takeB.id)?.selected).toBe(true);
    });
});
