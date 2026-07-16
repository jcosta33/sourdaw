import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));

describe('mixer snapshot operations', () => {
    it('saveMixerSnapshot is defined', async () => {
        const mod = await import('../saveMixerSnapshot');
        expect(mod).toBeDefined();
    });
    it('recallMixerSnapshot is defined', async () => {
        const mod = await import('../recallMixerSnapshot');
        expect(mod).toBeDefined();
    });
    it('renameMixerSnapshot is defined', async () => {
        const mod = await import('../renameMixerSnapshot');
        expect(mod).toBeDefined();
    });
    it('deleteMixerSnapshot is defined', async () => {
        const mod = await import('../deleteMixerSnapshot');
        expect(mod).toBeDefined();
    });
});
