/**
 * An export prints the whole compensated mix (#7312).
 *
 * `getCompensationDelay` holds every strip back until it meets the session's
 * deepest latency, so content scheduled up to the project end reaches the
 * output that much later. The span therefore has to grow by that depth, read
 * from the same latency input the schedulers hand `getCompensationDelay`, and
 * the tail setting stays the musician's own.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Device } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultTransportState } from '#/modules/Transport/stores';

import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { clearReportedLatency } from '../../latencyCompensation/compensation/clearReportedLatency';
import { reportLatency } from '../../latencyCompensation/compensation/reportLatency';
import { captureOfflineRenderInput } from '../captureOfflineRenderInput';
import { type OfflineRenderProjectSource } from '../OfflineRenderSource';

registerDeviceEnginePorts();

const SAMPLE_RATE = 48_000;
const BEATS = 8;
/** Half a second a beat. */
const PROJECT_SECONDS = 4;
const LATENCY_MS = 250;

const latencyDevice: Device = { id: 'glue-1', name: 'Gluten', type: 'gluten', bypassed: false, parameterValues: {} };

function projectWith(devices: Device[]): OfflineRenderProjectSource {
    return {
        tracks: {
            tracks: [{ ...createTrack({ id: 'fx', name: 'Fx', kind: 'audio' }), devices }],
            selectedTrackId: null,
        },
        midi: null,
        transport: { ...defaultTransportState, tempo: 120 },
        tempoMap: null,
        timeSignatureMap: null,
        automationLanes: [],
        takeLanes: null,
        gainEnvelopes: {},
        sidechainRoutes: [],
        vcaGroups: [],
        grooveTemplates: null,
        chordTrack: null,
        yeastProcessorsByDevice: {},
    };
}

function capture(input: { devices: Device[]; startBeat?: number; durationBeats?: number; tailSeconds?: number }) {
    return captureOfflineRenderInput(
        {
            durationBeats: input.durationBeats ?? BEATS,
            startBeat: input.startBeat ?? 0,
            tailSeconds: input.tailSeconds ?? 0,
            sampleRate: SAMPLE_RATE,
        },
        { project: projectWith(input.devices) }
    );
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = ({ startPpq, endPpq, sampleRate }) => ({
        startSamples: startPpq * 0.5 * sampleRate,
        endSamples: endPpq * 0.5 * sampleRate,
        durationSamples: (endPpq - startPpq) * 0.5 * sampleRate,
        startSeconds: startPpq * 0.5,
        endSeconds: endPpq * 0.5,
        durationSeconds: (endPpq - startPpq) * 0.5,
    });
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = ({ defaultTempo }) => defaultTempo;
});

afterEach(() => {
    clearReportedLatency(latencyDevice.id);
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
});

describe('captureOfflineRenderInput span', () => {
    it('widens the render by exactly the session depth, with the tail untouched', () => {
        reportLatency(latencyDevice.id, LATENCY_MS);

        const captured = capture({ devices: [latencyDevice] });

        expect(captured.renderContext.durationSeconds).toBeCloseTo(PROJECT_SECONDS + LATENCY_MS / 1000, 9);
        expect(captured.renderContext.tailSeconds).toBe(0);
        expect(captured.outputFrameCount).toBe((PROJECT_SECONDS + LATENCY_MS / 1000) * SAMPLE_RATE);
    });

    it('leaves the span as the project and tail make it when nothing reports latency', () => {
        const captured = capture({ devices: [latencyDevice], tailSeconds: 1 });

        expect(captured.renderContext.durationSeconds).toBe(PROJECT_SECONDS + 1);
        expect(captured.outputFrameCount).toBe((PROJECT_SECONDS + 1) * SAMPLE_RATE);
    });

    it('widens a window render by the same depth and keeps its history before it', () => {
        reportLatency(latencyDevice.id, LATENCY_MS);

        const captured = capture({ devices: [latencyDevice], startBeat: 4, durationBeats: 4 });

        expect(captured.historyFrameCount).toBe(2 * SAMPLE_RATE);
        expect(captured.outputFrameCount).toBe((2 + LATENCY_MS / 1000) * SAMPLE_RATE);
    });
});
