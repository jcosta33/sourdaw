import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { captureOfflineRenderInput, configureOfflinePpqEndpointProjection } from '#/modules/AudioEngine/useCases';
import {
    beatAtSecondsFromAnchor,
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';

import { cutAgentMeasurementWindow, type AgentMeasurementWindow } from '../cutAgentMeasurementWindow';
import { readAgentMeasurementTimeline } from '../readAgentMeasurementTimeline';

const SAMPLE_RATE = 44_100;

/** The part of `AudioBuffer` a cut writes and reads, which the test environment does not provide. */
class FrameBuffer {
    readonly sampleRate: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly duration: number;
    private readonly channels: Float32Array[];

    constructor(options: AudioBufferOptions) {
        this.sampleRate = options.sampleRate;
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels ?? 1;
        this.duration = options.length / options.sampleRate;
        this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(options.length));
    }

    getChannelData(channel: number): Float32Array {
        const data = this.channels[channel];
        if (data === undefined) {
            throw new RangeError('Unknown audio channel.');
        }
        return data;
    }

    copyToChannel(source: Float32Array, channel: number): void {
        this.getChannelData(channel).set(source.subarray(0, this.length));
    }
}

/** The timeline frames the offline renderer keeps for a render of `range` alone, by its own law. */
function framesKept(range: AgentMeasurementWindow): { first: number; length: number } {
    const { historyFrameCount, outputFrameCount } = captureOfflineRenderInput({
        startBeat: range.startBeat,
        durationBeats: range.endBeat - range.startBeat,
        sampleRate: SAMPLE_RATE,
        tailSeconds: 0,
    });
    return { first: historyFrameCount, length: outputFrameCount };
}

/** A render of `span` whose every sample holds the timeline frame it was rendered at. */
function renderOfFrames(span: AgentMeasurementWindow): AudioBuffer {
    const { first, length } = framesKept(span);
    const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
    buffer.copyToChannel(
        Float32Array.from({ length }, (_, frame) => first + frame),
        0
    );
    return buffer;
}

/** The timeline frames a cut holds: its first and last sample, and how many. */
function framesOf(buffer: AudioBuffer): { first: number; length: number; last: number } {
    const data = buffer.getChannelData(0);
    return { first: data[0] ?? Number.NaN, length: buffer.length, last: data[buffer.length - 1] ?? Number.NaN };
}

/** Windows starting and ending off whole frames, inside one span and against its edges. */
function windowsOf(span: AgentMeasurementWindow): AgentMeasurementWindow[] {
    const windows: AgentMeasurementWindow[] = [];
    for (let startBeat = span.startBeat; startBeat < span.endBeat - 0.5; startBeat += 0.37) {
        for (const length of [0.29, 1.13, 2.71]) {
            const endBeat = Math.min(span.endBeat, startBeat + length);
            windows.push({ startBeat, endBeat });
        }
    }
    return windows;
}

function expectEveryCutMatchesItsOwnRender(span: AgentMeasurementWindow): void {
    const buffer = renderOfFrames(span);
    const timeline = readAgentMeasurementTimeline();
    for (const window of windowsOf(span)) {
        const cut = cutAgentMeasurementWindow({ buffer, span, window, timeline });
        const alone = framesKept(window);
        expect({ window, frames: cut === null ? null : framesOf(cut) }).toEqual({
            window,
            frames: { first: alone.first, length: alone.length, last: alone.first + alone.length - 1 },
        });
    }
}

beforeEach(() => {
    vi.stubGlobal('AudioBuffer', FrameBuffer);
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    configureOfflinePpqEndpointProjection({
        project: projectPpqEndpoints,
        resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        beatAtSecondsFromAnchor,
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    restoreTransportSnapshot({ tempo: 120 });
    restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
});

describe('a measurement window cut out of a wider render', () => {
    it('holds the frames a render of that window alone keeps, where beats fall between frames', () => {
        restoreTransportSnapshot({ tempo: 97 });
        restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
        expectEveryCutMatchesItsOwnRender({ startBeat: 1.7, endBeat: 12.9 });
    });

    it('holds the frames a render of that window alone keeps, across a tempo change', () => {
        restoreTransportSnapshot({ tempo: 97 });
        restoreTimelineMapSnapshot({
            tempoMap: { changes: [{ id: 'slower', beat: 6.3, tempo: 71, curve: 'instant' }] },
        });
        expectEveryCutMatchesItsOwnRender({ startBeat: 0, endBeat: 14.1 });
    });
});
