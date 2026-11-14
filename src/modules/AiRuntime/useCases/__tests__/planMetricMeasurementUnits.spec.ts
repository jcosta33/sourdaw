import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { configureOfflinePpqEndpointProjection } from '#/modules/AudioEngine/useCases';
import {
    beatAtSecondsFromAnchor,
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';

import { countMeasurementUnitWork } from '../countMeasurementUnitWork';
import { type MeasurementRequest } from '../planMetricMeasurementRequests';
import { planMetricMeasurementUnits } from '../planMetricMeasurementUnits';

/** A DSP layer whose one region starts at beat 16: steady across a mixdown span ending at or before it. */
const LATE_EQ: AdjustmentLayer = {
    id: 'late-eq',
    name: 'Late EQ',
    effectType: 'eq',
    parameters: [{ name: 'Low Gain', value: -6, min: -24, max: 24, unit: 'dB' }],
    affectedTrackIds: ['track-a'],
    insertionIndex: 0,
    regions: [{ id: 'late', startBeat: 16, endBeat: 24, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
    enabled: true,
    mix: 1,
    color: '#fff',
};

const LIVE = { tempo: 120, changes: [] };
/**
 * The preview document halves its tempo at beat 10. Its mixdown walks a render of `[0, 8]` (4 s) to
 * beat 10 + 4 = 14, short of the layer, and one of `[0, 16]` (5 s + 6 s) to beat 10 + 11 = 21, past
 * it: a render of both sections drops the layer the verse alone keeps. The live project walks
 * `[0, 16]` to beat 16 and keeps it either way.
 */
const PREVIEW = {
    tempo: 120,
    changes: [
        { id: 'start', beat: 0, tempo: 120, curve: 'instant' as const },
        { id: 'halved', beat: 10, tempo: 60, curve: 'instant' as const },
    ],
};

const SECTIONS = [
    { startBeat: 0, endBeat: 8, sectionId: 'verse' },
    { startBeat: 8, endBeat: 16, sectionId: 'chorus' },
];

function requests(scope: MeasurementRequest['scope']): MeasurementRequest[] {
    return SECTIONS.map((range) => ({ prefix: 'batch', scope, range, metrics: ['rms'] }));
}

function groupSpans(unit: ReturnType<typeof planMetricMeasurementUnits>[number] | undefined) {
    return unit?.groups.map(({ startBeat, endBeat }) => ({ startBeat, endBeat }));
}

describe('preview measurement units under a prefix document with its own tempo map', () => {
    beforeEach(() => {
        restoreTransportSnapshot({ tempo: LIVE.tempo });
        restoreTimelineMapSnapshot({ tempoMap: { changes: LIVE.changes } });
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            beatAtSecondsFromAnchor,
        });
        adjustmentLayerStore.set({ layers: [LATE_EQ] });
    });

    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
    });

    it('lets two sections share a mixdown render when every document reads their ends alike', () => {
        const [unit, ...rest] = planMetricMeasurementUnits({
            requests: requests({ kind: 'master' }),
            subject: 'preview',
            readPrefixTimeline: () => LIVE,
        });

        expect(rest).toEqual([]);
        expect(groupSpans(unit)).toEqual([{ startBeat: 0, endBeat: 16 }]);
        expect(countMeasurementUnitWork(unit!).renderJobs).toBe(2);
    });

    it('renders apart the sections a prefix document’s tempo map carries across a layer threshold', () => {
        const [unit, ...rest] = planMetricMeasurementUnits({
            requests: requests({ kind: 'master' }),
            subject: 'preview',
            readPrefixTimeline: (prefix) => {
                expect(prefix).toBe('batch');
                return PREVIEW;
            },
        });

        expect(rest).toEqual([]);
        // The verse renders alone in both documents, so the preview's verse figure keeps the layer.
        expect(groupSpans(unit)).toEqual([
            { startBeat: 0, endBeat: 8 },
            { startBeat: 8, endBeat: 16 },
        ]);
        // What the fit counts is what this grouping renders: the live project and the prefix, per group.
        expect(countMeasurementUnitWork(unit!).renderJobs).toBe(4);
    });

    it('opens no prefix document for a subgraph unit, whose classification walks no tempo map', () => {
        const readPrefixTimeline = vi.fn(() => PREVIEW);

        const [unit] = planMetricMeasurementUnits({
            requests: requests({ kind: 'tracks', ids: ['track-a'] }),
            subject: 'preview',
            readPrefixTimeline,
        });

        expect(readPrefixTimeline).not.toHaveBeenCalled();
        expect(groupSpans(unit)).toEqual([{ startBeat: 0, endBeat: 16 }]);
    });
});
