import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';

import { clampRenderFrameCount } from '../../../repositories/clampRenderFrameCount';
import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
import { cropHistoryFromRenderedBuffer } from '../cropHistoryFromRenderedBuffer';
import { resolveHistoryAwareRenderContext } from '../resolveHistoryAwareRenderContext';
import { resolveRenderContext } from '../resolveRenderContext';

/** A ramp whose every sample is its own frame index; Float64 holds every index of a long timeline exactly. */
function frameIndexRamp(length: number) {
    const ramp = new Float64Array(length);
    for (let frame = 0; frame < length; frame++) {
        ramp[frame] = frame;
    }
    return ramp;
}

/** Holds one channel whose every sample is its own frame index, so a crop shows where it cut. */
class FrameIndexBuffer {
    readonly length: number;
    readonly sampleRate: number;
    readonly numberOfChannels: number;
    private readonly channels: Float64Array[];

    constructor({ length, sampleRate, numberOfChannels }: AudioBufferOptions) {
        this.length = length;
        this.sampleRate = sampleRate;
        this.numberOfChannels = numberOfChannels ?? 1;
        this.channels = Array.from({ length: this.numberOfChannels }, () => frameIndexRamp(length));
    }

    getChannelData(channel: number) {
        return this.channels[channel]!;
    }

    copyToChannel(source: Float64Array, channel: number) {
        this.channels[channel]!.set(source);
    }
}

// The Nebula Drift demo's clock: 76 BPM, a ramp to 78 BPM from beat 148 and back from beat 232.
const NEBULA_DRIFT_TEMPO_MAP = [
    { id: 'open', beat: 0, tempo: 76, curve: 'instant' as const },
    { id: 'peak', beat: 148, tempo: 78, curve: 'linear' as const },
    { id: 'breakdown', beat: 232, tempo: 76, curve: 'linear' as const },
];

type RegionRequest = { startBeat: number; durationBeats: number; tailSeconds: number; sampleRate: number };

/** Renders the timeline-zero history buffer a region export produces, then crops it. */
function renderRegion(request: RegionRequest) {
    const window = resolveHistoryAwareRenderContext(request);
    const renderFrameCount = clampRenderFrameCount({
        durationSeconds: window.renderContext.durationSeconds,
        sampleRate: request.sampleRate,
    });
    const buffer = new AudioBuffer({ length: renderFrameCount, numberOfChannels: 1, sampleRate: request.sampleRate });
    const output = cropHistoryFromRenderedBuffer({ buffer, ...window });
    return { output, renderFrameCount };
}

/** The frame count the same region yields when rendered on its own, without timeline history. */
function standaloneFrameCount(request: RegionRequest) {
    return clampRenderFrameCount({
        durationSeconds: resolveRenderContext(request).durationSeconds,
        sampleRate: request.sampleRate,
    });
}

/** The region's first frame on the absolute timeline grid the tempo map projects. */
function regionStartFrame({ startBeat, sampleRate }: RegionRequest) {
    return projectPpqEndpoints({
        startPpq: 0,
        endPpq: startBeat,
        defaultTempo: 120,
        sampleRate,
        changes: NEBULA_DRIFT_TEMPO_MAP,
    }).endSamples;
}

describe('cropHistoryFromRenderedBuffer', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', FrameIndexBuffer);
        restoreTransportSnapshot({ tempo: 76 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: NEBULA_DRIFT_TEMPO_MAP } });
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('exports the Nebula Drift loop at beats 165-204 with its tail, as long as the region rendered alone', () => {
        const request = { startBeat: 165, durationBeats: 39, tailSeconds: 2, sampleRate: 44_100 };

        const { output, renderFrameCount } = renderRegion(request);

        expect(output.length).toBe(standaloneFrameCount(request));
        const samples = output.getChannelData(0);
        expect(samples[0]).toBe(regionStartFrame(request));
        // The window ends on the render's last frame, so the whole tail is in the file.
        expect(samples[output.length - 1]).toBe(renderFrameCount - 1);
    });

    it('keeps a region whose history ends on a whole frame starting on that frame', () => {
        restoreTransportSnapshot({ tempo: 120 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
        const request = { startBeat: 4, durationBeats: 8, tailSeconds: 2, sampleRate: 48_000 };

        const { output, renderFrameCount } = renderRegion(request);

        // Four beats at 120 BPM are exactly two seconds of history; eight beats and the tail are six seconds.
        expect(output.length).toBe(6 * 48_000);
        expect(output.length).toBe(standaloneFrameCount(request));
        expect(output.getChannelData(0)[0]).toBe(2 * 48_000);
        expect(renderFrameCount).toBe(8 * 48_000);
    });

    const cropRegions = [
        { startBeat: 165, durationBeats: 39 },
        { startBeat: 4, durationBeats: 8 },
        { startBeat: 100, durationBeats: 20 },
        { startBeat: 148, durationBeats: 10 },
        { startBeat: 33, durationBeats: 7 },
    ];
    const cropSampleRates = [44_100, 48_000];
    const cropTails = [0, 0.37, 1.5, 2];

    it.each(
        cropRegions.flatMap((region) =>
            cropSampleRates.flatMap((sampleRate) =>
                cropTails.map((tailSeconds) => ({ ...region, sampleRate, tailSeconds }))
            )
        )
    )(
        'crops beats $startBeat+$durationBeats at $sampleRate Hz with a $tailSeconds s tail from its absolute first frame to the render end',
        (request) => {
            const { output, renderFrameCount } = renderRegion(request);

            const samples = output.getChannelData(0);
            expect(samples[0]).toBe(regionStartFrame(request));
            expect(samples[output.length - 1]).toBe(renderFrameCount - 1);
        }
    );

    it('returns the render untouched when the region starts at timeline zero', () => {
        const request = { startBeat: 0, durationBeats: 39, tailSeconds: 2, sampleRate: 44_100 };

        const { output, renderFrameCount } = renderRegion(request);

        expect(output.length).toBe(renderFrameCount);
        expect(output.length).toBe(standaloneFrameCount(request));
    });
});
