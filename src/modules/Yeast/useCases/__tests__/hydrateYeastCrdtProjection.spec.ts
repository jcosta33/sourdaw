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
    // This used to assert the opposite — that the projection reconciled groove
    // assignments. Review round 1 on PR #793 called it out: reconciliation
    // writes the `grooveTemplates` slot, so running it here made the projection
    // a second writer (audit CC-2) and made the incremental local-origin skip
    // silently disable a safety net. The reconciliation now runs at the
    // mutation site, `commitYeastProjection`.
    it('projects the yeast slot without writing groove assignments', () => {
        hydrateYeastCrdtProjection();

        expect(mocks.hydrate).toHaveBeenCalledOnce();
        expect(mocks.reconcile).not.toHaveBeenCalled();
    });
});
