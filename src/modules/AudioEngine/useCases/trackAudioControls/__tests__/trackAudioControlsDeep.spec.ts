import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));

describe('Track audio controls', () => {
    it('setTrackGain loads', async () => {
        const mod = await import('../setTrackGain');
        expect(mod).toBeDefined();
    });
    it('setTrackPan loads', async () => {
        const mod = await import('../setTrackPan');
        expect(mod).toBeDefined();
    });
});
