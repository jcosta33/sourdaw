import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore, type TempoMapStoreState } from '#/modules/Transport/stores';
import { projectPpqEndpoints } from '#/modules/Transport/useCases';

/** One beat range a measurement reads out of a render. */
export type AgentMeasurementWindow = { startBeat: number; endBeat: number };

/** The tempo a document places beats on the timeline with: the stores answering when it was read. */
export type AgentMeasurementTimeline = { tempo: number; changes: TempoMapStoreState['changes'] };

/** The timeline of whichever document's stores answer while this runs. */
export function readAgentMeasurementTimeline(): AgentMeasurementTimeline {
    return { tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM, changes: tempoMapStore.value?.changes ?? [] };
}

function secondsFromTimelineStart(beat: number, timeline: AgentMeasurementTimeline, sampleRate: number): number {
    const projection = projectPpqEndpoints({
        startPpq: 0,
        endPpq: beat,
        defaultTempo: timeline.tempo,
        sampleRate,
        changes: timeline.changes,
    });
    return Math.max(0, projection.durationSeconds);
}

/**
 * The timeline frames a render of `window` keeps, by the offline renderer's own law
 * (`resolveHistoryAwareRenderContext`): it renders from beat 0, starts the kept region on the frame
 * its first beat rounds to and ends it on the render's last frame, the duration counted up.
 */
function readWindowFrames(window: AgentMeasurementWindow, timeline: AgentMeasurementTimeline, sampleRate: number) {
    const endBeat = window.startBeat + (window.endBeat - window.startBeat);
    const first =
        window.startBeat <= 0
            ? 0
            : Math.round(secondsFromTimelineStart(window.startBeat, timeline, sampleRate) * sampleRate);
    return { first, end: Math.ceil(secondsFromTimelineStart(endBeat, timeline, sampleRate) * sampleRate) };
}

/**
 * The samples a render of `window` alone would hold, read out of a render of `span` that contains
 * it. An offline render starts at beat 0 whatever range it keeps and adds no tail, so the frames
 * one range keeps are the same frames inside a render of a wider range ending later. The window is
 * copied into a buffer of its own, so whatever reduces it — integrated-loudness gating, a true-peak
 * filter — starts on the window's first sample exactly as it would on a render of that range.
 * `null` when the span render does not hold the window.
 */
export function cutAgentMeasurementWindow(input: {
    buffer: AudioBuffer;
    span: AgentMeasurementWindow;
    window: AgentMeasurementWindow;
    timeline: AgentMeasurementTimeline;
}): AudioBuffer | null {
    const { buffer, span, window } = input;
    if (window.startBeat === span.startBeat && window.endBeat === span.endBeat) {
        return buffer;
    }
    const spanFrames = readWindowFrames(span, input.timeline, buffer.sampleRate);
    const windowFrames = readWindowFrames(window, input.timeline, buffer.sampleRate);
    const start = windowFrames.first - spanFrames.first;
    const end = windowFrames.end - spanFrames.first;
    if (start < 0 || end <= start || end > buffer.length) {
        return null;
    }
    const output = new AudioBuffer({
        length: end - start,
        numberOfChannels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
    });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        output.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
    }
    return output;
}

/** The range every window falls inside: what one render must cover to hold them all. */
export function readAgentMeasurementSpan(windows: readonly AgentMeasurementWindow[]): AgentMeasurementWindow {
    return {
        startBeat: Math.min(...windows.map((window) => window.startBeat)),
        endBeat: Math.max(...windows.map((window) => window.endBeat)),
    };
}
