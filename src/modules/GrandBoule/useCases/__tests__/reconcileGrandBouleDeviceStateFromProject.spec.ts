import { describe, expect, it, vi } from 'vitest';

const morph = { modelA: 'mellow-grand', modelB: 'clear-grand', morphPosition: 0.3, layerBalance: 0, enabled: true };
const mocks = vi.hoisted(() => ({
    apply: vi.fn(),
    hydrate: vi.fn(),
    engine: { isReady: vi.fn() },
}));

vi.mock('../applyGrandBouleMorphState', () => ({ applyGrandBouleMorphState: mocks.apply }));
vi.mock('../hydrateGrandBouleMorphStateFromProject', () => ({
    hydrateGrandBouleMorphStateFromProject: mocks.hydrate,
}));
vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => mocks.engine }));

import { reconcileGrandBouleDeviceStateFromProject } from '../reconcileGrandBouleDeviceStateFromProject';

describe('reconcileGrandBouleDeviceStateFromProject', () => {
    it('updates session hydration and the ready engine without dispatching an action', () => {
        mocks.hydrate.mockReturnValue(morph);
        mocks.engine.isReady.mockReturnValue(true);

        reconcileGrandBouleDeviceStateFromProject('grand-1');

        expect(mocks.hydrate).toHaveBeenCalledWith('grand-1');
        expect(mocks.apply).toHaveBeenCalledWith(mocks.engine, morph);
    });
});
