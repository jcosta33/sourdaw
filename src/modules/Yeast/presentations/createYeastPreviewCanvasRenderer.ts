import type { DenseRenderer, YeastPreviewRenderModel } from './YeastPreviewTypes';
import type { YeastPreviewEvent } from '../models/YeastPreviewSnapshot';

type YeastPreviewGeometryInput = YeastPreviewRenderModel;

type YeastPreviewEventGeometry = Readonly<{
    eventId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    brightness: number;
    opacity: number;
    tone: 'active' | 'bypassed' | 'failed' | 'unrealized';
}>;

export type YeastPreviewGeometry = Readonly<{
    events: readonly YeastPreviewEventGeometry[];
    pitchRange: Readonly<{ minimum: number; maximum: number }>;
}>;

const PITCH_PADDING = 8;
const EVENT_HEIGHT = 6;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function normalizeVelocity(velocity: number): number {
    if (velocity > 1) {
        return clamp(velocity / 127, 0, 1);
    }
    return clamp(velocity, 0, 1);
}

function isEventVisible(event: YeastPreviewEvent, playheadBeat: number, lookaheadEnd: number): boolean {
    if (event.beatTime > lookaheadEnd) {
        return false;
    }
    if (!event.realized) {
        return event.beatTime > playheadBeat;
    }
    return event.beatTime + Math.max(0, event.durationBeats) > playheadBeat;
}

function resolveTone(event: YeastPreviewEvent): YeastPreviewEventGeometry['tone'] {
    if (event.failed) {
        return 'failed';
    }
    if (event.bypassed) {
        return 'bypassed';
    }
    if (!event.realized) {
        return 'unrealized';
    }
    return 'active';
}

function resolveOpacity(event: YeastPreviewEvent, playheadBeat: number, lookaheadBeats: number): number {
    const brightness = normalizeVelocity(event.velocity);
    const activeOpacity = 0.25 + brightness * 0.7;
    if (event.bypassed) {
        return Math.min(0.35, activeOpacity * 0.45);
    }
    if (!event.realized) {
        const distance = clamp((event.beatTime - playheadBeat) / lookaheadBeats, 0, 1);
        return 0.08 + distance * 0.42;
    }
    return activeOpacity;
}

export function createYeastPreviewGeometry(input: YeastPreviewGeometryInput): YeastPreviewGeometry {
    const lookaheadBeats = Math.max(0.25, input.lookaheadBeats);
    const lookbehindStart = input.playheadBeat - lookaheadBeats;
    const lookaheadEnd = input.playheadBeat + lookaheadBeats;
    const pitchEvents = input.events.filter(
        (event) => event.beatTime >= lookbehindStart && event.beatTime <= lookaheadEnd
    );
    let minimum = 60;
    let maximum = 72;
    if (pitchEvents.length > 0) {
        minimum = Math.min(...pitchEvents.map((event) => event.pitch));
        maximum = Math.max(...pitchEvents.map((event) => event.pitch));
        if (minimum === maximum) {
            minimum -= 1;
            maximum += 1;
        }
    }

    const drawableHeight = Math.max(EVENT_HEIGHT, input.height - PITCH_PADDING * 2);
    const pitchSpan = Math.max(1, maximum - minimum);
    const events = input.events
        .filter((event) => isEventVisible(event, input.playheadBeat, lookaheadEnd))
        .map((event): YeastPreviewEventGeometry => {
            const startRatio = clamp((event.beatTime - input.playheadBeat) / lookaheadBeats, 0, 1);
            const endRatio = clamp(
                (event.beatTime + Math.max(0, event.durationBeats) - input.playheadBeat) / lookaheadBeats,
                0,
                1
            );
            const pitchRatio = (event.pitch - minimum) / pitchSpan;
            return {
                eventId: event.eventId,
                x: startRatio * input.width,
                y: PITCH_PADDING + (1 - pitchRatio) * (drawableHeight - EVENT_HEIGHT),
                width: Math.max(2, (endRatio - startRatio) * input.width),
                height: EVENT_HEIGHT,
                brightness: normalizeVelocity(event.velocity),
                opacity: resolveOpacity(event, input.playheadBeat, lookaheadBeats),
                tone: resolveTone(event),
            };
        });

    return { events, pitchRange: { minimum, maximum } };
}

function colorForEvent(event: YeastPreviewEventGeometry): string {
    if (event.tone === 'bypassed') {
        return `rgba(148, 163, 184, ${event.opacity})`;
    }
    if (event.tone === 'failed') {
        return `rgba(248, 113, 113, ${event.opacity})`;
    }
    if (event.tone === 'unrealized') {
        return `rgba(251, 191, 36, ${event.opacity})`;
    }
    const channel = Math.round(160 + event.brightness * 95);
    return `rgba(251, ${channel}, 96, ${event.opacity})`;
}

export function createYeastPreviewCanvasRenderer(
    canvas: HTMLCanvasElement
): DenseRenderer<YeastPreviewRenderModel> | null {
    const contextCandidate = canvas.getContext('2d');
    if (!contextCandidate) {
        return null;
    }
    const context: CanvasRenderingContext2D = contextCandidate;

    let width = 640;
    let height = 112;

    function render(model: YeastPreviewRenderModel): void {
        const dpr = window.devicePixelRatio || 1;
        context.clearRect(0, 0, width * dpr, height * dpr);
        context.save();
        context.scale(dpr, dpr);
        context.fillStyle = 'rgba(255, 255, 255, 0.025)';
        context.fillRect(0, 0, width, height);

        context.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        context.beginPath();
        context.moveTo(0.5, 0);
        context.lineTo(0.5, height);
        context.stroke();

        const geometry = createYeastPreviewGeometry({ ...model, width, height });
        for (const event of geometry.events) {
            context.fillStyle = colorForEvent(event);
            context.fillRect(event.x, event.y, event.width, event.height);
        }
        context.restore();
    }

    function resize(nextWidth: number, nextHeight: number): void {
        const dpr = window.devicePixelRatio || 1;
        width = Math.max(1, nextWidth);
        height = Math.max(1, nextHeight);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }

    function dispose(): void {
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    return { backend: 'canvas2d', render, resize, dispose };
}
