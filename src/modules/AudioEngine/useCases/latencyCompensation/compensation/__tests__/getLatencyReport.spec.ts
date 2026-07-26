import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48000 }),
}));

// The AudioEngine singleton's context holds baseLatency/outputLatency the report
// copies into the result. Stub the engine so we can drive both context shapes
// (outputLatency present vs absent) without standing up the real Web Audio graph.
// vi.hoisted makes the shared object available to the hoisted vi.mock factory.
const { mockContext } = vi.hoisted((): { mockContext: { baseLatency?: number; outputLatency?: number } } => ({
    mockContext: {},
}));
vi.mock('../../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { context: mockContext },
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { getLatencyReport } from '../getLatencyReport';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

// `mockContext` is the stubbed audioEngine.context (see vi.mock above).
const ctx = mockContext;

function makeTrack(id: string, devices: Array<{ id: string; type: string }> = []): unknown {
    return {
        id,
        outputId: 'hw_out',
        devices: devices.map((d) => ({ id: d.id, name: d.id, type: d.type, bypassed: false, parameterValues: {} })),
        sends: [],
    };
}

// 128 / 48000 * 1000 — sidechain-compressor device latency at the mocked rate.
const SIDECHAIN_COMP_MS = (128 / 48000) * 1000;

describe('getLatencyReport', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        ctx.baseLatency = 0;
        delete ctx.outputLatency;
    });

    it('returns zeroed latencies when the track store has no state', () => {
        const report = getLatencyReport();
        expect(report.tracks).toEqual([]);
        expect(report.maxLatencyMs).toBe(0);
    });

    it('aggregates per-track device latency and reports context latencies in ms', () => {
        ctx.baseLatency = 0.01; // 10 ms
        ctx.outputLatency = 0.005; // 5 ms
        mockTrackStore.value = {
            tracks: [makeTrack('t1', [{ id: 'sc', type: 'builtin-sidechain-compressor' }]), makeTrack('t2')],
        };

        const report = getLatencyReport();

        expect(report.tracks).toHaveLength(2);
        expect(report.tracks[0]).toMatchObject({ trackId: 't1' });
        expect(report.tracks[0]!.totalLatencyMs).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
        expect(report.tracks[1]!.totalLatencyMs).toBe(0);
        expect(report.maxLatencyMs).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
        expect(report.contextBaseLatencyMs).toBeCloseTo(10, 6);
        // outputLatency is present on this context → reported in ms.
        expect(report.contextOutputLatencyMs).toBeCloseTo(5, 6);
    });

    it('defaults baseLatency to 0 when undefined and reports 0 outputLatency when the key is absent', () => {
        ctx.baseLatency = undefined;
        delete ctx.outputLatency; // 'outputLatency' not in ctx → fallback branch
        mockTrackStore.value = { tracks: [makeTrack('solo')] };

        const report = getLatencyReport();

        expect(report.contextBaseLatencyMs).toBe(0);
        expect(report.contextOutputLatencyMs).toBe(0);
        expect(report.maxLatencyMs).toBe(0);
    });
});
