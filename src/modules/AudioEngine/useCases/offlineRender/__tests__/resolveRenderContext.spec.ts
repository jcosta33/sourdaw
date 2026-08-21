import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';

import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
import { resolveRenderContext } from '../resolveRenderContext';

describe('resolveRenderContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        });
    });

    it('returns durationSeconds for a plain duration (no start offset, no tail)', () => {
        const ctx = resolveRenderContext({ durationBeats: 8 });
        // 8 beats at 120 bpm = 4 seconds
        expect(ctx.durationSeconds).toBeCloseTo(4, 6);
        expect(ctx.startBeat).toBe(0);
        expect(ctx.tailSeconds).toBe(0);
    });

    it('subtracts the start offset so durationSeconds reflects only the region', () => {
        const ctx = resolveRenderContext({ durationBeats: 4, startBeat: 4 });
        // 4 beats at 120 bpm = 2 seconds
        expect(ctx.durationSeconds).toBeCloseTo(2, 6);
        expect(ctx.startBeat).toBe(4);
    });

    it('appends tail seconds onto the region length', () => {
        const ctx = resolveRenderContext({ durationBeats: 4, startBeat: 0, tailSeconds: 3 });
        // 4 beats at 120 bpm = 2 seconds, plus 3s tail = 5s
        expect(ctx.durationSeconds).toBeCloseTo(5, 6);
        expect(ctx.tailSeconds).toBe(3);
    });

    it('uses canonical linear-tempo projection for a cropped render duration', () => {
        const changes = [
            { id: 'start', beat: 0, tempo: 60, curve: 'linear' as const },
            { id: 'end', beat: 8, tempo: 180, curve: 'instant' as const },
        ];
        restoreTimelineMapSnapshot({ tempoMap: { changes } });
        const expected = projectPpqEndpoints({
            startPpq: 2,
            endPpq: 6,
            defaultTempo: 120,
            sampleRate: 48_000,
            changes,
        });

        const ctx = resolveRenderContext({ durationBeats: 4, startBeat: 2, sampleRate: 48_000 });

        expect(ctx.durationSeconds).toBe(expected.durationSeconds);
    });

    it('supports the legacy numeric input form', () => {
        const ctx = resolveRenderContext(4);
        expect(ctx.durationSeconds).toBeCloseTo(2, 6);
        expect(ctx.startBeat).toBe(0);
        expect(ctx.tailSeconds).toBe(0);
    });

    it('snapshots the PPQ projector for the lifetime of one render context', () => {
        const firstProjector = vi.fn<Parameters<typeof configureOfflinePpqEndpointProjection>[0]['project']>();
        const replacementProjector = vi.fn<Parameters<typeof configureOfflinePpqEndpointProjection>[0]['project']>();
        configureOfflinePpqEndpointProjection({
            project: firstProjector,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        });

        const context = resolveRenderContext(4);
        configureOfflinePpqEndpointProjection({
            project: replacementProjector,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        });

        expect(context.projectPpqEndpoints).toBe(firstProjector);
    });
});
