import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    getMidiStoreState: vi.fn(),
    getTransportStoreValue: vi.fn(),
    getTempoMapState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiStoreState: mocks.getMidiStoreState,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportStoreValue: mocks.getTransportStoreValue,
    getTempoMapState: mocks.getTempoMapState,
}));

describe('resolveRenderContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getMidiStoreState.mockReturnValue({ notesByClipId: {} });
        mocks.getTransportStoreValue.mockReturnValue({ tempo: 120, masterGain: 80 });
        mocks.getTempoMapState.mockReturnValue({ changes: [] });
    });

    it('returns durationSeconds for a plain duration (no start offset, no tail)', async () => {
        const { resolveRenderContext } = await import('../resolveRenderContext');
        const ctx = resolveRenderContext({ durationBeats: 8 });
        // 8 beats at 120 bpm = 4 seconds
        expect(ctx.durationSeconds).toBeCloseTo(4, 6);
        expect(ctx.startBeat).toBe(0);
        expect(ctx.tailSeconds).toBe(0);
    });

    it('subtracts the start offset so durationSeconds reflects only the region', async () => {
        const { resolveRenderContext } = await import('../resolveRenderContext');
        const ctx = resolveRenderContext({ durationBeats: 4, startBeat: 4 });
        // 4 beats at 120 bpm = 2 seconds
        expect(ctx.durationSeconds).toBeCloseTo(2, 6);
        expect(ctx.startBeat).toBe(4);
    });

    it('appends tail seconds onto the region length', async () => {
        const { resolveRenderContext } = await import('../resolveRenderContext');
        const ctx = resolveRenderContext({ durationBeats: 4, startBeat: 0, tailSeconds: 3 });
        // 4 beats at 120 bpm = 2 seconds, plus 3s tail = 5s
        expect(ctx.durationSeconds).toBeCloseTo(5, 6);
        expect(ctx.tailSeconds).toBe(3);
    });

    it('supports the legacy numeric input form', async () => {
        const { resolveRenderContext } = await import('../resolveRenderContext');
        const ctx = resolveRenderContext(4);
        expect(ctx.durationSeconds).toBeCloseTo(2, 6);
        expect(ctx.startBeat).toBe(0);
        expect(ctx.tailSeconds).toBe(0);
    });
});
