import { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

import type {
    DenseRenderer,
    YeastPreviewFeedback,
    YeastPreviewProcessorActivity,
    YeastPreviewRenderModel,
} from './YeastPreviewTypes';
import type {
    YeastPreviewEvent,
    YeastPreviewProcessorProvenance,
    YeastPreviewSnapshot,
} from '../models/YeastPreviewSnapshot';

type PresenterDependencies = {
    renderer: DenseRenderer<YeastPreviewRenderModel>;
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (handle: number) => void;
    setTimer: (callback: () => void, delayMs: number) => number;
    clearTimer: (handle: number) => void;
    now: () => number;
    readPlayheadBeat: () => number;
    onFeedback: (feedback: YeastPreviewFeedback) => void;
};

type YeastPreviewPresenter = {
    acceptSnapshot(snapshot: YeastPreviewSnapshot, sampledAt?: number): void;
    resetForScope(): void;
    beginProcessorRevision(revision: number): void;
    acknowledgeProcessorRevision(revision: number, captureEpoch: number): void;
    updateView(input: { lookaheadBeats?: number }): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

const SILENCE_THRESHOLD_MS = 500;
const LATENCY_SAMPLE_CAPACITY = 64;

function percentile95(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((alpha, beta) => alpha - beta);
    const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index] ?? null;
}

function isExpired(event: YeastPreviewEvent, playheadBeat: number, lookaheadBeats: number): boolean {
    const retentionStart = playheadBeat - lookaheadBeats;
    if (!event.realized) {
        return event.beatTime <= retentionStart;
    }
    return event.beatTime + Math.max(0, event.durationBeats) <= retentionStart;
}

function createProcessorActivity(
    provenance: readonly YeastPreviewProcessorProvenance[]
): YeastPreviewProcessorActivity[] {
    return provenance.map((entry) => {
        let status: YeastPreviewProcessorActivity['status'] = 'enabled';
        if (entry.failed) {
            status = 'failed';
        } else if (entry.bypassed) {
            status = 'bypassed';
        } else if (entry.eventCount > 0) {
            status = 'active';
        }
        return { processorId: entry.processorId, eventCount: entry.eventCount, status };
    });
}

export function createYeastPreviewSummary(events: readonly YeastPreviewEvent[]): string {
    const eventLabel = events.length === 1 ? 'event' : 'events';
    if (events.length === 0) {
        return '0 upcoming events';
    }
    const pitches = events.map((event) => event.pitch);
    const minimumPitch = Math.min(...pitches);
    const maximumPitch = Math.max(...pitches);
    const bypassed = events.filter((event) => event.bypassed).length;
    const unrealized = events.filter((event) => !event.realized).length;
    const nonDeterministic = events.filter((event) => event.probability === null).length;
    const details = [`pitches ${minimumPitch} to ${maximumPitch}`];
    if (bypassed > 0) {
        details.push(`${bypassed} bypassed`);
    }
    if (unrealized > 0) {
        details.push(`${unrealized} unrealized`);
    }
    if (nonDeterministic > 0) {
        details.push(`${nonDeterministic} non-deterministic`);
    }
    return `${events.length} upcoming ${eventLabel}; ${details.join('; ')}`;
}

export function createYeastPreviewPresenter(deps: PresenterDependencies): YeastPreviewPresenter {
    const events = new Map<number, YeastPreviewEvent>();
    const latencySamples: number[] = [];
    let processorActivity: YeastPreviewProcessorActivity[] = [];
    let width = 640;
    let height = 112;
    let lookaheadBeats = 4;
    let frameHandle: number | null = null;
    let silenceTimer: number | null = null;
    let latestSampleAt: number | null = null;
    let lastActivityAt: number | null = null;
    let sampleRevision = 0;
    let renderedSampleRevision = -1;
    let hasSample = false;
    let droppedEvents = 0;
    let droppedFrames = 0;
    let droppedVisualEvents = 0;
    let latestProcessorRevision = 0;
    let pendingProcessorRevision: number | null = null;
    let expectedCaptureEpoch: number | null = null;
    let snapshotsSuspended = false;
    let disposed = false;

    function cancelPendingFrame(): void {
        if (frameHandle === null) {
            return;
        }
        deps.cancelFrame(frameHandle);
        frameHandle = null;
    }

    function clearProjectionState(resetDropMetrics: boolean): void {
        events.clear();
        latencySamples.length = 0;
        processorActivity = [];
        latestSampleAt = null;
        lastActivityAt = null;
        sampleRevision = 0;
        renderedSampleRevision = -1;
        hasSample = false;
        if (silenceTimer !== null) {
            deps.clearTimer(silenceTimer);
            silenceTimer = null;
        }
        if (!resetDropMetrics) {
            return;
        }
        droppedEvents = 0;
        droppedFrames = 0;
        droppedVisualEvents = 0;
    }

    function publishBlankFrame(): void {
        const playheadBeat = deps.readPlayheadBeat();
        deps.renderer.render({ events: [], playheadBeat, lookaheadBeats, width, height });
        deps.onFeedback({
            hasSample: false,
            active: false,
            latencyP95Ms: null,
            visibleEvents: 0,
            droppedEvents,
            droppedFrames,
            droppedVisualEvents,
            processorActivity: [],
            summary: createYeastPreviewSummary([]),
            soundingPitches: [],
        });
    }

    function pruneExpired(playheadBeat: number): void {
        for (const [eventId, event] of events) {
            if (isExpired(event, playheadBeat, lookaheadBeats)) {
                events.delete(eventId);
            }
        }
    }

    function isSounding(event: YeastPreviewEvent, playheadBeat: number): boolean {
        return (
            event.realized &&
            event.beatTime <= playheadBeat &&
            event.beatTime + Math.max(0, event.durationBeats) > playheadBeat
        );
    }

    function currentSoundingPitches(playheadBeat: number): number[] {
        const pitches: number[] = [];
        for (const event of events.values()) {
            if (isSounding(event, playheadBeat)) {
                pitches.push(event.pitch);
            }
        }
        return pitches;
    }

    function currentVisibleEvents(playheadBeat: number): YeastPreviewEvent[] {
        const lookaheadEnd = playheadBeat + lookaheadBeats;
        return [...events.values()].filter((event) => {
            if (event.beatTime > lookaheadEnd) {
                return false;
            }
            if (!event.realized) {
                return event.beatTime > playheadBeat;
            }
            return event.beatTime + Math.max(0, event.durationBeats) > playheadBeat;
        });
    }

    function publishFrame(frameAt: number): void {
        frameHandle = null;
        const playheadBeat = deps.readPlayheadBeat();
        pruneExpired(playheadBeat);
        const renderEvents = [...events.values()];
        deps.renderer.render({ events: renderEvents, playheadBeat, lookaheadBeats, width, height });

        if (latestSampleAt !== null && renderedSampleRevision !== sampleRevision) {
            latencySamples.push(Math.max(0, frameAt - latestSampleAt));
            if (latencySamples.length > LATENCY_SAMPLE_CAPACITY) {
                latencySamples.shift();
            }
            renderedSampleRevision = sampleRevision;
        }

        const visibleEvents = currentVisibleEvents(playheadBeat);
        const active = lastActivityAt !== null && frameAt - lastActivityAt < SILENCE_THRESHOLD_MS;
        const effectiveProcessorActivity = processorActivity.map((entry) => {
            if (active || entry.status !== 'active') {
                return entry;
            }
            return { ...entry, status: 'enabled' as const };
        });
        deps.onFeedback({
            hasSample,
            active,
            latencyP95Ms: percentile95(latencySamples),
            visibleEvents: visibleEvents.length,
            droppedEvents,
            droppedFrames,
            droppedVisualEvents,
            processorActivity: effectiveProcessorActivity,
            summary: createYeastPreviewSummary(visibleEvents),
            soundingPitches: currentSoundingPitches(playheadBeat),
        });
    }

    function scheduleFrame(countPendingAsDropped = true): void {
        if (disposed) {
            return;
        }
        if (frameHandle !== null) {
            if (countPendingAsDropped) {
                droppedFrames += 1;
            }
            return;
        }
        frameHandle = deps.requestFrame((timestamp) => publishFrame(timestamp));
    }

    function scheduleSilenceFrame(sampledAt: number): void {
        if (silenceTimer !== null) {
            deps.clearTimer(silenceTimer);
        }
        const delay = Math.max(0, sampledAt + SILENCE_THRESHOLD_MS - deps.now());
        silenceTimer = deps.setTimer(() => {
            silenceTimer = null;
            scheduleFrame(false);
        }, delay);
    }

    function acceptSnapshot(snapshot: YeastPreviewSnapshot, sampledAt = deps.now()): void {
        if (disposed) {
            return;
        }
        if (snapshotsSuspended) {
            return;
        }
        if (expectedCaptureEpoch !== null && snapshot.captureEpoch !== expectedCaptureEpoch) {
            return;
        }
        hasSample = true;
        latestSampleAt = sampledAt;
        sampleRevision += 1;
        droppedEvents += snapshot.droppedEvents;
        processorActivity = createProcessorActivity(snapshot.provenance);
        if (snapshot.reset) {
            events.clear();
        }

        const playheadBeat = deps.readPlayheadBeat();
        pruneExpired(playheadBeat);
        for (const event of snapshot.events) {
            if (!events.has(event.eventId) && events.size === YEAST_PREVIEW_CAPACITY) {
                droppedVisualEvents += 1;
                continue;
            }
            events.set(event.eventId, event);
        }
        const hasActiveProvenance = snapshot.provenance.some(
            (entry) => !entry.bypassed && !entry.failed && entry.eventCount > 0
        );
        const hasActiveEventWithoutProvenance =
            snapshot.provenance.length === 0 && snapshot.events.some((event) => !event.bypassed && !event.failed);
        if (hasActiveProvenance || hasActiveEventWithoutProvenance) {
            lastActivityAt = sampledAt;
            scheduleSilenceFrame(sampledAt);
        }
        scheduleFrame();
    }

    function resetForScope(): void {
        if (disposed) {
            return;
        }
        cancelPendingFrame();
        clearProjectionState(true);
        latestProcessorRevision = 0;
        pendingProcessorRevision = null;
        expectedCaptureEpoch = null;
        snapshotsSuspended = false;
        publishBlankFrame();
    }

    function beginProcessorRevision(revision: number): void {
        if (disposed || !Number.isSafeInteger(revision) || revision < 1 || revision === latestProcessorRevision) {
            return;
        }
        latestProcessorRevision = revision;
        pendingProcessorRevision = revision;
        snapshotsSuspended = true;
        expectedCaptureEpoch = null;
        clearProjectionState(false);
        scheduleFrame(false);
    }

    function acknowledgeProcessorRevision(revision: number, captureEpoch: number): void {
        if (
            disposed ||
            revision !== pendingProcessorRevision ||
            !Number.isSafeInteger(captureEpoch) ||
            captureEpoch < 1
        ) {
            return;
        }
        pendingProcessorRevision = null;
        expectedCaptureEpoch = captureEpoch;
        snapshotsSuspended = false;
    }

    function updateView(input: { lookaheadBeats?: number }): void {
        if (input.lookaheadBeats !== undefined) {
            lookaheadBeats = Math.max(0.25, Math.min(64, input.lookaheadBeats));
        }
        scheduleFrame(false);
    }

    function resize(nextWidth: number, nextHeight: number): void {
        width = Math.max(1, nextWidth);
        height = Math.max(1, nextHeight);
        deps.renderer.resize(width, height);
        scheduleFrame(false);
    }

    function dispose(): void {
        disposed = true;
        cancelPendingFrame();
        if (silenceTimer !== null) {
            deps.clearTimer(silenceTimer);
            silenceTimer = null;
        }
        events.clear();
        deps.renderer.dispose();
    }

    return {
        acceptSnapshot,
        resetForScope,
        beginProcessorRevision,
        acknowledgeProcessorRevision,
        updateView,
        resize,
        dispose,
    };
}
