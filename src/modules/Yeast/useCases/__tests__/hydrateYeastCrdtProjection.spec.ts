import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    hydrate: vi.fn(),
    reconcile: vi.fn(),
}));

vi.mock('../../stores/yeastStore', () => ({ yeastStore: { hydrate: mocks.hydrate } }));
vi.mock('../reconcileYeastGrooveAssignments', () => ({
    reconcileYeastGrooveAssignments: mocks.reconcile,
}));

const { hydrateYeastCrdtProjection } = await import('../hydrateYeastCrdtProjection');

describe('hydrateYeastCrdtProjection', () => {
    it('reconciles groove assignments after remote projection hydration', () => {
        hydrateYeastCrdtProjection();

        expect(mocks.hydrate).toHaveBeenCalledOnce();
        expect(mocks.reconcile).toHaveBeenCalledOnce();
    });
});
