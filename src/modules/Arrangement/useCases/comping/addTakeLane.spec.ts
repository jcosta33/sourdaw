import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { addTakeLane } from './addTakeLane';

describe('addTakeLane', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('no-ops when store is empty', () => {
        const set = vi.fn();
        injectDependencies(addTakeLane, {
            takeLaneStore: {
                value: null,
                set,
            } as never,
        });
        addTakeLane('t1');
        expect(set).not.toHaveBeenCalled();
    });

    it('adds a lane when missing', () => {
        const set = vi.fn();
        injectDependencies(addTakeLane, {
            takeLaneStore: {
                value: { lanes: [] },
                set,
            } as never,
        });
        addTakeLane('t1');
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
    });

    it('does not duplicate an existing lane', () => {
        const lane = createTakeLane('t1');
        const set = vi.fn();
        injectDependencies(addTakeLane, {
            takeLaneStore: {
                value: { lanes: [lane] },
                set,
            } as never,
        });
        addTakeLane('t1');
        expect(set).not.toHaveBeenCalled();
    });
});
