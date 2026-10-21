import { beforeEach, describe, expect, it } from 'vitest';

import {
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
    secondsBetweenBeats,
} from '#/modules/Transport/useCases';

import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
import { resolveHistoryAwareRenderContext } from '../resolveHistoryAwareRenderContext';

const SAMPLE_RATE = 48_000;
const HALF_SAMPLE_SECONDS = 0.5 / SAMPLE_RATE;

describe('resolveHistoryAwareRenderContext', () => {
    beforeEach(() => {
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        });
    });

    it('measures the history before a render that starts inside a tempo ramp through the live integral', () => {
        const changes = [
            { id: 'start', beat: 0, tempo: 100, curve: 'linear' as const },
            { id: 'end', beat: 8, tempo: 200, curve: 'instant' as const },
        ];
        restoreTimelineMapSnapshot({ tempoMap: { changes } });

        const { historySeconds, outputDurationSeconds, renderContext } = resolveHistoryAwareRenderContext({
            durationBeats: 2,
            startBeat: 5,
            sampleRate: SAMPLE_RATE,
        });

        expect(Math.abs(historySeconds - secondsBetweenBeats(changes, 0, 5, 120))).toBeLessThanOrEqual(
            HALF_SAMPLE_SECONDS
        );
        expect(Math.abs(outputDurationSeconds - secondsBetweenBeats(changes, 5, 7, 120))).toBeLessThanOrEqual(
            2 * HALF_SAMPLE_SECONDS
        );
        expect(renderContext.startBeat).toBe(0);
    });

    it('plays the first change tempo before it when the render starts after that change', () => {
        const changes = [{ id: 'slow', beat: 4, tempo: 90, curve: 'instant' as const }];
        restoreTimelineMapSnapshot({ tempoMap: { changes } });

        const { historySeconds, outputDurationSeconds } = resolveHistoryAwareRenderContext({
            durationBeats: 2,
            startBeat: 5,
            sampleRate: SAMPLE_RATE,
        });

        // The first change governs the whole timeline before it, as it does
        // live: five beats at 90 BPM last 10/3 s, not 2 s at the default 120 BPM
        // plus 2/3 s.
        expect(historySeconds).toBeCloseTo(10 / 3, 9);
        expect(historySeconds).toBeCloseTo(secondsBetweenBeats(changes, 0, 5, 120), 9);
        // Beats 5-7 at 90 BPM last 4/3 s.
        expect(outputDurationSeconds).toBeCloseTo(4 / 3, 9);
    });
});
