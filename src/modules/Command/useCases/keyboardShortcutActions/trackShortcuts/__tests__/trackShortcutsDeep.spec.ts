import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));

describe('Track shortcut actions', () => {
    it('duplicateTrack loads', async () => {
        const mod = await import('../duplicateTrack');
        expect(mod).toBeDefined();
    });
    it('addTrack loads', async () => {
        const mod = await import('../addTrack');
        expect(mod).toBeDefined();
    });
    it('clearSolos loads', async () => {
        const mod = await import('../clearSolos');
        expect(mod).toBeDefined();
    });
    it('duplicateClip loads', async () => {
        const mod = await import('../duplicateClip');
        expect(mod).toBeDefined();
    });
    it('duplicateClipToNextBar loads', async () => {
        const mod = await import('../duplicateClipToNextBar');
        expect(mod).toBeDefined();
    });
    it('zoomTracksVertical loads', async () => {
        const mod = await import('../zoomTracksVertical');
        expect(mod).toBeDefined();
    });
});
