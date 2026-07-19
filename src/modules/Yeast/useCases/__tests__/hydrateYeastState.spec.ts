import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    reconcile: vi.fn(),
    set: vi.fn(),
    value: { processors: [], uiLevel: 3 },
}));

vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.value;
        },
        set: mocks.set,
    },
}));
vi.mock('../reconcileYeastGrooveAssignments', () => ({
    reconcileYeastGrooveAssignments: mocks.reconcile,
}));

const { hydrateYeastState } = await import('../hydrateYeastState');

describe('hydrateYeastState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reconciles groove assignments after project hydration', () => {
        hydrateYeastState({
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
        });

        expect(mocks.set).toHaveBeenCalledWith({
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });

    it('reconciles groove assignments after resetting absent project state', () => {
        hydrateYeastState(undefined);

        expect(mocks.set).toHaveBeenCalledWith({ processors: [], uiLevel: 3 });
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });
});
