import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
    secondsBetweenBeats,
} from '#/modules/Transport/useCases';

import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
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

    describe('region length follows the tempo map live playback walks', () => {
        const SAMPLE_RATE = 48_000;
        const HALF_SAMPLE_SECONDS = 0.5 / SAMPLE_RATE;

        it('integrates a linear ramp: 100 BPM at beat 0 rising to 200 BPM at beat 8', () => {
            const changes = [
                { id: 'start', beat: 0, tempo: 100, curve: 'linear' as const },
                { id: 'end', beat: 8, tempo: 200, curve: 'instant' as const },
            ];
            restoreTimelineMapSnapshot({ tempoMap: { changes } });

            const ctx = resolveRenderContext({ durationBeats: 6, sampleRate: SAMPLE_RATE });

            // Tempo(b) = 100 + 12.5 b, so seconds = (60 / 12.5) * ln(tempo(6) / 100).
            expect(Math.abs(ctx.durationSeconds - 4.8 * Math.log(1.75))).toBeLessThanOrEqual(HALF_SAMPLE_SECONDS);
            expect(Math.abs(ctx.durationSeconds - secondsBetweenBeats(changes, 0, 6, 120))).toBeLessThanOrEqual(
                HALF_SAMPLE_SECONDS
            );
        });

        it('plays the first change tempo before it: 90 BPM from beat 4 under a 120 BPM project', () => {
            const changes = [{ id: 'slow', beat: 4, tempo: 90, curve: 'instant' as const }];
            restoreTimelineMapSnapshot({ tempoMap: { changes } });

            const ctx = resolveRenderContext({ durationBeats: 6, sampleRate: SAMPLE_RATE });

            // The first change governs the whole timeline before it, as it does
            // live: six beats at 90 BPM last 4 s, not 2 s at the default 120 BPM
            // plus 4/3 s.
            expect(ctx.durationSeconds).toBeCloseTo(4, 9);
            expect(ctx.durationSeconds).toBeCloseTo(secondsBetweenBeats(changes, 0, 6, 120), 9);
        });

        it('refuses to measure a region when no composition root injected the projector', () => {
            offlinePpqEndpointProjectorState.project = null;

            expect(() => resolveRenderContext({ durationBeats: 4 })).toThrow(
                'Offline musical projection is not configured'
            );
        });
    });

    it('supports the legacy numeric input form', () => {
        const ctx = resolveRenderContext(4);
        expect(ctx.durationSeconds).toBeCloseTo(2, 6);
        expect(ctx.startBeat).toBe(0);
        expect(ctx.tailSeconds).toBe(0);
    });

    it('snapshots the PPQ projector for the lifetime of one render context', () => {
        const firstProjector =
            vi.fn<Parameters<typeof configureOfflinePpqEndpointProjection>[0]['project']>(projectPpqEndpoints);
        const replacementProjector =
            vi.fn<Parameters<typeof configureOfflinePpqEndpointProjection>[0]['project']>(projectPpqEndpoints);
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
