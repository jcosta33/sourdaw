import { type ReactElement, useEffect, useRef, useState } from 'react';

import { readYeastPreviewSnapshot } from '../../useCases/yeastSchedulingBridge/readYeastPreviewSnapshot';
import { setYeastPreviewCaptureEnabled } from '../../useCases/yeastSchedulingBridge/setYeastPreviewCaptureEnabled';

import type { YeastPreviewEvent } from '../../models/YeastPreviewSnapshot';

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;

function drawPreview(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    events: readonly YeastPreviewEvent[]
): void {
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    if (events.length === 0) {
        return;
    }

    let minPitch = 127;
    let maxPitch = 0;
    let minBeat = Number.POSITIVE_INFINITY;
    let maxBeat = Number.NEGATIVE_INFINITY;
    for (const event of events) {
        minPitch = Math.min(minPitch, event.pitch);
        maxPitch = Math.max(maxPitch, event.pitch);
        minBeat = Math.min(minBeat, event.beatTime);
        maxBeat = Math.max(maxBeat, event.beatTime + Math.max(event.durationBeats, 0.05));
    }

    const pitchFloor = Math.max(0, minPitch - 3);
    const pitchCeiling = Math.min(127, maxPitch + 3);
    const pitchSpan = Math.max(1, pitchCeiling - pitchFloor + 1);
    const beatSpan = Math.max(0.5, maxBeat - minBeat);
    const laneHeight = height / pitchSpan;
    for (const event of events) {
        const velocityBrightness = Math.max(0, Math.min(1, event.velocity / 127));
        const probabilityOpacity = event.probability === null ? 1 : Math.max(0.08, Math.min(1, event.probability));
        const x = ((event.beatTime - minBeat) / beatSpan) * width;
        const y = height - (event.pitch - pitchFloor + 1) * laneHeight;
        const eventWidth = Math.max(2, (Math.max(event.durationBeats, 0.02) / beatSpan) * width);
        context.fillStyle = `hsl(24 90% ${Math.round(30 + velocityBrightness * 45)}%)`;
        context.globalAlpha = probabilityOpacity * (event.realized ? 1 : 0.35);
        context.fillRect(x, y, eventWidth, Math.max(2, laneHeight - 1));
    }
    context.globalAlpha = 1;
}

function eventKey(event: YeastPreviewEvent): string {
    return `${event.rackId}\u0000${event.routeId}\u0000${event.eventId}`;
}

export function YeastPreviewCanvas({ trackId }: { trackId: string | null }): ReactElement {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [failedTrackId, setFailedTrackId] = useState<string | null>(null);

    useEffect(() => {
        if (trackId === null || failedTrackId === trackId) {
            return undefined;
        }
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) {
            const unavailableTimer = setTimeout(() => setFailedTrackId(trackId), 0);
            return () => clearTimeout(unavailableTimer);
        }

        const visibleEvents = new Map<string, YeastPreviewEvent>();
        let active = true;
        let frameId = 0;
        let lastPaint = Number.NEGATIVE_INFINITY;
        let projectionVersion = -1;
        setYeastPreviewCaptureEnabled({ trackId, enabled: true });

        const paint = (now: number): void => {
            if (!active) {
                return;
            }
            if (now - lastPaint >= PREVIEW_FRAME_INTERVAL_MS) {
                lastPaint = now;
                try {
                    const snapshot = readYeastPreviewSnapshot({ trackId });
                    if (snapshot.reset || snapshot.projectionVersion !== projectionVersion) {
                        visibleEvents.clear();
                        projectionVersion = snapshot.projectionVersion;
                    }
                    for (const event of snapshot.events) {
                        visibleEvents.set(eventKey(event), event);
                    }
                    while (visibleEvents.size > snapshot.capacity) {
                        const oldestKey = visibleEvents.keys().next().value;
                        if (typeof oldestKey !== 'string') {
                            break;
                        }
                        visibleEvents.delete(oldestKey);
                    }
                    drawPreview(context, canvas, [...visibleEvents.values()]);
                } catch {
                    active = false;
                    setYeastPreviewCaptureEnabled({ trackId, enabled: false });
                    setFailedTrackId(trackId);
                    return;
                }
            }
            frameId = requestAnimationFrame(paint);
        };

        frameId = requestAnimationFrame(paint);
        return () => {
            active = false;
            cancelAnimationFrame(frameId);
            setYeastPreviewCaptureEnabled({ trackId, enabled: false });
        };
    }, [failedTrackId, trackId]);

    if (trackId === null) {
        return (
            <div className="yeast-window px-3 py-5 text-[10px] text-muted-foreground" role="status">
                Select a MIDI track to preview its scheduled notes.
            </div>
        );
    }

    if (failedTrackId === trackId) {
        return (
            <div className="yeast-window px-3 py-5 text-[10px] text-muted-foreground" role="status">
                Preview unavailable. MIDI processing continues normally.
            </div>
        );
    }

    return (
        <section className="yeast-window p-3" aria-label="Phrase view">
            <div className="mb-2 text-[10px] font-medium text-foreground">Phrase view</div>
            <canvas
                ref={canvasRef}
                width={640}
                height={128}
                className="h-32 w-full rounded-lg bg-black/20"
                role="img"
                aria-label={`Upcoming Yeast MIDI notes for ${trackId}`}
            />
        </section>
    );
}
