import { type ReactElement, useEffect, useRef, useState } from 'react';

import { playheadPositionRef } from '#/modules/Transport/stores';

import { type YeastRuntimeStatus } from '../../models/YeastProcessorProjection';
import { subscribeYeastPreviewRevision } from '../../stores/yeastPreviewRevision';
import { resetYeastPreviewCapture } from '../../useCases/resetYeastPreviewCapture';
import { subscribeYeastPreview } from '../../useCases/subscribeYeastPreview';
import { createYeastPreviewCanvasRenderer } from '../createYeastPreviewCanvasRenderer';
import { createYeastPreviewPresenter } from '../createYeastPreviewPresenter';

import type { YeastPreviewFeedback, YeastPreviewScope, YeastPreviewUnavailableReason } from '../YeastPreviewTypes';

function requestPreviewFrame(callback: FrameRequestCallback): number {
    return window.requestAnimationFrame(callback);
}

function cancelPreviewFrame(handle: number): void {
    window.cancelAnimationFrame(handle);
}

function setPreviewTimer(callback: () => void, delayMs: number): number {
    return window.setTimeout(callback, delayMs);
}

function clearPreviewTimer(handle: number): void {
    window.clearTimeout(handle);
}

type PreviewProcessor = Readonly<{ id: string; bypassed: boolean }>;

type YeastPreviewSurfaceProps = {
    scope: YeastPreviewScope | null;
    unavailableReason?: YeastPreviewUnavailableReason;
    processors: readonly PreviewProcessor[];
    runtimeStatus?: YeastRuntimeStatus;
    runtimeError?: string;
    lookaheadBeats?: number;
    /** Reports the rack's currently-sounding pitches — KeyboardSplit's note-activity source. */
    onSoundingNotesChange?: (pitches: readonly number[]) => void;
};

type SurfaceStatus = Readonly<{
    label: 'Available' | 'Initializing' | 'Active' | 'Bypassed' | 'Silent' | 'Unavailable' | 'Error';
    reason?: Readonly<{ code: string; message: string }>;
}>;

type ProcessorStatusCounts = Readonly<{
    total: number;
    active: number;
    enabled: number;
    bypassed: number;
    failed: number;
}>;

const initialFeedback: YeastPreviewFeedback = {
    hasSample: false,
    active: false,
    latencyP95Ms: null,
    visibleEvents: 0,
    droppedEvents: 0,
    droppedFrames: 0,
    droppedVisualEvents: 0,
    processorActivity: [],
    summary: '0 upcoming events',
    soundingPitches: [],
};

function countProcessorStatuses(
    processors: readonly PreviewProcessor[],
    feedback: YeastPreviewFeedback
): ProcessorStatusCounts {
    const activityByProcessor = new Map(feedback.processorActivity.map((entry) => [entry.processorId, entry]));
    const counts = { total: processors.length, active: 0, enabled: 0, bypassed: 0, failed: 0 };
    for (const processor of processors) {
        const activity = activityByProcessor.get(processor.id);
        if (activity?.status === 'failed') {
            counts.failed += 1;
            continue;
        }
        if (processor.bypassed || activity?.status === 'bypassed') {
            counts.bypassed += 1;
            continue;
        }
        if (activity?.status === 'active') {
            counts.active += 1;
            continue;
        }
        counts.enabled += 1;
    }
    return counts;
}

function resolveSurfaceStatus(input: {
    scope: YeastPreviewScope | null;
    unavailableReason?: YeastPreviewUnavailableReason;
    runtimeStatus?: YeastRuntimeStatus;
    runtimeError?: string;
    rendererUnavailable: boolean;
    feedback: YeastPreviewFeedback;
    processorCounts: ProcessorStatusCounts;
}): SurfaceStatus {
    if (input.rendererUnavailable) {
        return { label: 'Error', reason: { code: 'renderer-unavailable', message: 'Canvas preview is unavailable.' } };
    }
    if (input.runtimeError) {
        return { label: 'Error', reason: { code: 'runtime-error', message: input.runtimeError } };
    }
    if (!input.scope) {
        const reason = input.unavailableReason ?? {
            code: 'no-track',
            message: 'Select a MIDI track.',
        };
        return { label: 'Unavailable', reason };
    }
    if (input.runtimeStatus === 'unavailable') {
        return {
            label: 'Unavailable',
            reason: { code: 'runtime-unavailable', message: 'The Yeast runtime is unavailable.' },
        };
    }
    if (input.runtimeStatus === 'initializing') {
        return { label: 'Initializing' };
    }
    if (input.processorCounts.failed > 0) {
        return {
            label: 'Error',
            reason: {
                code: 'processor-failed',
                message: 'A Yeast processor failed while generating preview events.',
            },
        };
    }
    if (input.processorCounts.total > 0 && input.processorCounts.bypassed === input.processorCounts.total) {
        return { label: 'Bypassed' };
    }
    if (input.feedback.active) {
        return { label: 'Active' };
    }
    if (input.feedback.hasSample) {
        return { label: 'Silent' };
    }
    return { label: 'Available' };
}

export function YeastPreviewSurface({
    scope,
    unavailableReason,
    processors,
    runtimeStatus,
    runtimeError,
    lookaheadBeats = 4,
    onSoundingNotesChange,
}: YeastPreviewSurfaceProps): ReactElement {
    const viewportRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const presenterRef = useRef<ReturnType<typeof createYeastPreviewPresenter> | null>(null);
    const processorsRef = useRef(processors);
    const pendingProcessorRevisionRef = useRef<number | null>(null);
    const onSoundingNotesChangeRef = useRef(onSoundingNotesChange);
    const [rendererUnavailable, setRendererUnavailable] = useState(false);
    const [feedback, setFeedback] = useState<YeastPreviewFeedback>(initialFeedback);

    useEffect(() => {
        onSoundingNotesChangeRef.current = onSoundingNotesChange;
    }, [onSoundingNotesChange]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const viewport = viewportRef.current;
        if (!canvas || !viewport) {
            return undefined;
        }
        const previewCanvas: HTMLCanvasElement = canvas;
        const previewViewport: HTMLDivElement = viewport;
        const renderer = createYeastPreviewCanvasRenderer(previewCanvas);
        if (!renderer) {
            setRendererUnavailable(true);
            return undefined;
        }
        const presenter = createYeastPreviewPresenter({
            renderer,
            requestFrame: requestPreviewFrame,
            cancelFrame: cancelPreviewFrame,
            setTimer: setPreviewTimer,
            clearTimer: clearPreviewTimer,
            now: () => performance.now(),
            readPlayheadBeat: () => playheadPositionRef.current,
            onFeedback: (nextFeedback) => {
                setFeedback(nextFeedback);
                onSoundingNotesChangeRef.current?.(nextFeedback.soundingPitches);
            },
        });
        presenterRef.current = presenter;

        function resize(): void {
            const bounds = previewViewport.getBoundingClientRect();
            presenter.resize(bounds.width || 640, bounds.height || 112);
        }
        resize();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
        observer?.observe(previewViewport);

        return () => {
            observer?.disconnect();
            presenter.dispose();
            presenterRef.current = null;
        };
    }, []);

    useEffect(() => {
        processorsRef.current = processors;
    }, [processors]);

    const rackId = scope?.rackId;
    const routeId = scope?.routeId;
    const trackId = scope?.trackId;
    useEffect(() => {
        const presenter = presenterRef.current;
        if (!presenter) {
            return undefined;
        }
        presenter.resetForScope();
        if (!rackId || !routeId || !trackId) {
            return undefined;
        }
        const unsubscribe = subscribeYeastPreview({
            rackId,
            routeId,
            trackId,
            onSnapshot: (snapshot, sampledAt) => presenter.acceptSnapshot(snapshot, sampledAt),
        });
        return () => {
            unsubscribe();
            presenter.resetForScope();
        };
    }, [rackId, routeId, trackId]);

    useEffect(() => {
        const presenter = presenterRef.current;
        if (!presenter || !rackId || !routeId || !trackId) {
            return undefined;
        }
        pendingProcessorRevisionRef.current = null;
        const unsubscribe = subscribeYeastPreviewRevision(({ processorId, revision, phase }) => {
            if (phase === 'pending') {
                const ownsProcessor = processorsRef.current.some((processor) => processor.id === processorId);
                if (!ownsProcessor) {
                    return;
                }
                pendingProcessorRevisionRef.current = revision;
                presenter.beginProcessorRevision(revision);
                return;
            }
            if (revision !== pendingProcessorRevisionRef.current) {
                return;
            }
            pendingProcessorRevisionRef.current = null;
            const captureEpoch = resetYeastPreviewCapture({ rackId, routeId, trackId });
            if (captureEpoch === null) {
                return;
            }
            presenter.acknowledgeProcessorRevision(revision, captureEpoch);
        });
        return () => {
            unsubscribe();
            pendingProcessorRevisionRef.current = null;
        };
    }, [rackId, routeId, trackId]);

    useEffect(() => {
        if (!presenterRef.current) {
            return undefined;
        }
        presenterRef.current.updateView({ lookaheadBeats });
        return undefined;
    }, [lookaheadBeats]);

    const processorCounts = countProcessorStatuses(processors, feedback);
    const status = resolveSurfaceStatus({
        scope,
        unavailableReason,
        runtimeStatus,
        runtimeError,
        rendererUnavailable,
        feedback,
        processorCounts,
    });
    const latency = feedback.latencyP95Ms === null ? '—' : `${Math.round(feedback.latencyP95Ms)} ms`;
    const processorSummary = `${processorCounts.active} active · ${processorCounts.enabled} enabled · ${processorCounts.bypassed} bypassed · ${processorCounts.failed} failed`;

    return (
        <section className="yeast-window p-3" aria-label="Scheduled event preview">
            <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                    <div className="text-[10px] font-medium text-foreground">Phrase view</div>
                    <div className="text-[9px] text-muted-foreground">Read-only preview of upcoming rack output.</div>
                </div>
                <dl className="flex flex-wrap justify-end gap-3 text-[8px] text-muted-foreground">
                    <div>
                        <dt>Preview</dt>
                        <dd className="text-foreground">{status.label}</dd>
                    </div>
                    <div>
                        <dt>p95 latency</dt>
                        <dd className="text-foreground">{latency}</dd>
                    </div>
                    <div>
                        <dt>Processors</dt>
                        <dd className="text-foreground">{processorSummary}</dd>
                    </div>
                </dl>
            </div>
            <div ref={viewportRef} className="h-28 w-full">
                <canvas
                    ref={canvasRef}
                    className="block h-full w-full rounded-lg border border-white/10 bg-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-peach)]"
                    role="img"
                    tabIndex={0}
                    aria-label={feedback.summary}
                />
            </div>
            <div className="sr-only" role="status" aria-live="polite">
                {feedback.summary}. Preview {status.label.toLowerCase()}. Scheduling latency {latency}.
            </div>
            {status.reason ? (
                <div className="mt-2 text-[9px] text-muted-foreground" data-reason-code={status.reason.code}>
                    {status.reason.message}
                </div>
            ) : null}
        </section>
    );
}
