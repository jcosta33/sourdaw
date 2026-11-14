import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import {
    beatAtSecondsFromAnchor,
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';

import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
import { conservativeSpanEndBeat } from '../conservativeSpanEndBeat';
import { resolveTrackAdjustmentComposition } from '../offlineAdjustmentLayers';
import { readAdjustmentLayerConstancyThresholds } from '../readAdjustmentLayerConstancyThresholds';
import { readOfflineAdjustmentRenderClass } from '../readOfflineAdjustmentRenderClass';
import { resolveRenderContext } from '../resolveRenderContext';

const TRACK_ID = 'track-a';

function layer(
    id: string,
    regions: AdjustmentLayer['regions'],
    overrides: Partial<AdjustmentLayer> = {}
): AdjustmentLayer {
    return {
        id,
        name: id,
        effectType: 'eq',
        parameters: [{ name: 'Low Gain', value: -6, min: -24, max: 24, unit: 'dB' }],
        affectedTrackIds: [TRACK_ID],
        insertionIndex: 0,
        regions,
        enabled: true,
        mix: 1,
        color: '#fff',
        ...overrides,
    };
}

function region(startBeat: number, endBeat: number, fadeInBeats = 0, fadeOutBeats = 0) {
    return { id: `${startBeat}-${endBeat}`, startBeat, endBeat, blend: 1, fadeInBeats, fadeOutBeats };
}

/** Region shapes on either side of every branch of the classification. */
const LAYERS: AdjustmentLayer[] = [
    layer('always-on', []),
    layer('from-zero', [region(0, 8)]),
    layer('from-before-zero', [region(-4, 6)]),
    layer('late-start', [region(4, 12)]),
    layer('fade-in-from-zero', [region(0, 8, 2, 0)]),
    layer('fade-out-from-zero', [region(0, 8, 0, 2)]),
    layer('ends-before-zero', [region(-8, 0)]),
    layer('two-regions', [region(0, 10), region(6, 14)]),
    layer('disabled', [region(0, 4)], { enabled: false }),
];

const END_BEATS = Array.from({ length: 40 }, (_, index) => (index + 1) / 2);

/** Whether the real composition, over `[0, spanEndBeat]`, keeps the layer's DSP steady. */
function steadyOver(subject: AdjustmentLayer, spanEndBeat: number): boolean | null {
    const composition = resolveTrackAdjustmentComposition({
        layers: [subject],
        trackId: TRACK_ID,
        allTrackIds: [TRACK_ID],
        spanStartBeat: 0,
        spanEndBeat,
    });
    return composition.dsp[0]?.constant ?? null;
}

describe('adjustment-layer constancy thresholds', () => {
    it.each(LAYERS)('mark exactly where the composition turns $id from steady to moving', (subject) => {
        const thresholds = readAdjustmentLayerConstancyThresholds([subject]);
        expect(thresholds.length).toBeLessThanOrEqual(1);
        const threshold = thresholds[0] ?? Number.POSITIVE_INFINITY;
        for (const endBeat of END_BEATS) {
            const steady = steadyOver(subject, endBeat);
            if (steady === null) {
                // A layer the composition skips takes no decision a render end could change.
                expect(thresholds).toEqual([]);
                continue;
            }
            expect({ endBeat, steady }).toEqual({ endBeat, steady: endBeat <= threshold });
        }
    });
});

describe('the adjustment render class of a render end', () => {
    /** The document the renders read: the live project's tempo and tempo map below. */
    const TIMELINE = { tempo: 97, changes: [{ id: 'slower', beat: 6, tempo: 71, curve: 'instant' as const }] };

    beforeEach(() => {
        restoreTransportSnapshot({ tempo: TIMELINE.tempo });
        restoreTimelineMapSnapshot({ tempoMap: { changes: TIMELINE.changes } });
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
            beatAtSecondsFromAnchor,
        });
        adjustmentLayerStore.set({ layers: LAYERS });
    });

    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
    });

    /** The layers a render ending at `endBeat` takes as moving, classified over `spanEndBeat`. */
    function movingLayers(spanEndBeat: number): number {
        return LAYERS.filter((subject) => steadyOver(subject, spanEndBeat) === false).length;
    }

    it('counts the layers an isolated subgraph render classifies as moving over its own end', () => {
        for (const endBeat of END_BEATS) {
            expect({
                endBeat,
                renderClass: readOfflineAdjustmentRenderClass({ endBeat, route: 'subgraph', timeline: TIMELINE }),
            }).toEqual({
                endBeat,
                renderClass: movingLayers(endBeat),
            });
        }
    });

    it('counts the layers the mixdown classifies as moving over the conservative span its render context gives', () => {
        for (const endBeat of END_BEATS) {
            const { durationSeconds, defaultTempo, changes } = resolveRenderContext({
                durationBeats: endBeat,
                sampleRate: 48_000,
            });
            const spanEndBeat = conservativeSpanEndBeat(durationSeconds, defaultTempo, changes);
            expect({
                endBeat,
                renderClass: readOfflineAdjustmentRenderClass({ endBeat, route: 'mixdown', timeline: TIMELINE }),
            }).toEqual({
                endBeat,
                renderClass: movingLayers(spanEndBeat),
            });
        }
    });

    it('walks the mixdown span through the tempo map of the document it renders, not the live one', () => {
        // A preview document the live project does not match: its tempo halves at beat 10.
        const preview = {
            tempo: 120,
            changes: [
                { id: 'start', beat: 0, tempo: 120, curve: 'instant' as const },
                { id: 'halved', beat: 10, tempo: 60, curve: 'instant' as const },
            ],
        };
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
        adjustmentLayerStore.set({ layers: [layer('late', [region(16, 24)])] });
        const read = (endBeat: number, timeline: { tempo: number; changes: typeof preview.changes }) =>
            readOfflineAdjustmentRenderClass({ endBeat, route: 'mixdown', timeline });
        const live = { tempo: 120, changes: [] };

        // The live project reads both ends alike; the preview's slower tail carries a render to 16 past the layer.
        expect([read(8, live), read(16, live)]).toEqual([0, 0]);
        expect([read(8, preview), read(16, preview)]).toEqual([0, 1]);
        for (const endBeat of [8, 16]) {
            const { durationSeconds } = projectPpqEndpoints({
                startPpq: 0,
                endPpq: endBeat,
                defaultTempo: preview.tempo,
                sampleRate: 48_000,
                changes: preview.changes,
            });
            const spanEndBeat = conservativeSpanEndBeat(durationSeconds, preview.tempo, preview.changes);
            expect(read(endBeat, preview)).toBe(spanEndBeat > 16 ? 1 : 0);
        }
    });

    it('reads zero for every end with no layer that can move', () => {
        adjustmentLayerStore.set({ layers: [LAYERS[0]!] });
        expect(readOfflineAdjustmentRenderClass({ endBeat: 64, route: 'mixdown', timeline: TIMELINE })).toBe(0);
    });
});
