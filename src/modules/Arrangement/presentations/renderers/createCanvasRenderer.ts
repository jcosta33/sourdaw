import { type TimelineRenderer } from '../../models/RendererBackend';
import { type TimelineRenderModel } from '../../models/TimelineRenderModel';
import { transportStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { drawClip } from './clipDrawing';

export function createCanvasRenderer(canvas: HTMLCanvasElement): TimelineRenderer {
    const ctx = canvas.getContext('2d')!;
    let width = canvas.width;
    let height = canvas.height;

    function render(model: TimelineRenderModel): void {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, width * dpr, height * dpr);
        ctx.save();
        ctx.scale(dpr, dpr);

        const contentHeight = height;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, contentHeight);
        ctx.clip();
        ctx.translate(0, -model.scrollY);
        drawLoopRegion(ctx, model, contentHeight + model.scrollY);
        drawGrid(ctx, model, width, contentHeight + model.scrollY);
        drawTracks(ctx, model, width);
        drawTakeLanes(ctx, model);
        drawPlayhead(ctx, model, contentHeight + model.scrollY);
        ctx.restore();

        ctx.restore();
    }

    function resize(w: number, h: number): void {
        const dpr = window.devicePixelRatio || 1;
        width = w;
        height = h;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }

    const dispose = (): void => {};

    return { backend: 'canvas2d', render, resize, dispose };
}

function drawGrid(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, width: number, height: number): void {
    const { pixelsPerBeat, viewportStartBeat, timeSignatureNumerator, timeSignatureDenominator } = model;
    const startBeat = Math.floor(viewportStartBeat);
    const tsChanges = timeSignatureMapStore.value?.changes ?? [];

    let barStartBeat = 0;
    let currentNumerator = timeSignatureNumerator;
    for (const change of [...tsChanges].sort((a, b) => a.beat - b.beat)) {
        if (change.beat >= startBeat) {
            break;
        }
        const beatsInSegment = change.beat - barStartBeat;
        beatsInSegment;
        barStartBeat = change.beat;
        currentNumerator = change.numerator;
    }

    // Batch beat lines and bar lines separately to minimize strokeStyle changes
    ctx.lineWidth = 1;

    // Draw beat division lines first (#333-equivalent on #1a1a1a)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    let tempBarStart = barStartBeat;
    let tempNumerator = currentNumerator;
    for (let beat = startBeat; beat * pixelsPerBeat < width + viewportStartBeat * pixelsPerBeat; beat++) {
        const tsChange = tsChanges.find((c) => c.beat === beat);
        if (tsChange) {
            tempBarStart = beat;
            tempNumerator = tsChange.numerator;
        }
        const isBarLine = (beat - tempBarStart) % tempNumerator === 0;
        if (!isBarLine) {
            const x = (beat - viewportStartBeat) * pixelsPerBeat;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
    }
    ctx.stroke();

    // Draw bar lines (#555-equivalent — brighter)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.beginPath();
    tempBarStart = barStartBeat;
    tempNumerator = currentNumerator;
    for (let beat = startBeat; beat * pixelsPerBeat < width + viewportStartBeat * pixelsPerBeat; beat++) {
        const tsChange = tsChanges.find((c) => c.beat === beat);
        if (tsChange) {
            tempBarStart = beat;
            tempNumerator = tsChange.numerator;
        }
        const isBarLine = (beat - tempBarStart) % tempNumerator === 0;
        if (isBarLine) {
            const x = (beat - viewportStartBeat) * pixelsPerBeat;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
    }
    ctx.stroke();

    timeSignatureDenominator;
}

const TRACK_KIND_LABELS: Record<string, string> = {
    audio: 'AUDIO',
    midi: 'MIDI',
    bus: 'BUS',
    master: 'MASTER',
    folder: 'FOLDER',
};

function getTrackYOffsets(tracks: { height: number }[]): number[] {
    const offsets: number[] = [];
    let y = 0;
    for (const track of tracks) {
        offsets.push(y);
        y += track.height;
    }
    return offsets;
}

function drawTracks(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, width: number): void {
    const { tracks, selectedTrackId } = model;
    const yOffsets = getTrackYOffsets(tracks);

    for (const track of tracks) {
        const y = yOffsets[track.index]!;
        const isFolder = track.kind === 'folder';
        const h = isFolder ? 26 : track.height;
        const isSelected = track.id === selectedTrackId;
        const isEven = track.index % 2 === 0;

        // Background — #1a1a1a base with subtle alternation
        if (isFolder) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        } else if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        } else if (isEven) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.008)';
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
        }
        ctx.fillRect(0, y, width, h);

        // Left accent bar
        if (isFolder) {
            // Amber/gold accent for folder
            ctx.fillStyle = 'rgba(176, 144, 64, 0.4)';
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = track.color;
            ctx.globalAlpha = isSelected ? 0.5 : 0.25;
        }
        ctx.fillRect(0, y, 3, h);
        ctx.globalAlpha = 1;

        if (track.muted) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(0, y, width, h);
        }

        // Bottom separator
        ctx.strokeStyle = isFolder ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + h);
        ctx.lineTo(width, y + h);
        ctx.stroke();

        if (isSelected) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        if (isFolder) {
            // Folder label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.font = '600 9px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
            ctx.fillText(track.name.toUpperCase(), 10, y + h / 2 + 3);
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.font = '9px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
            const kindLabel = TRACK_KIND_LABELS[track.kind] ?? '';
            if (track.clips.length === 0) {
                ctx.fillStyle = 'rgba(153, 153, 153, 0.5)';
                ctx.fillText(`${track.name}  ·  ${kindLabel}`, 8, y + h / 2 + 3);

                ctx.fillStyle = 'rgba(102, 102, 102, 0.4)';
                ctx.font = '8px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
                ctx.fillText('Drop audio/MIDI here or use Draw tool', 8, y + h / 2 + 14);
            }

            for (const clip of track.clips) {
                drawClip(ctx, clip, model, y, h);
            }
        }
    }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, height: number): void {
    const { playheadPosition, viewportStartBeat, pixelsPerBeat } = model;
    const x = (playheadPosition - viewportStartBeat) * pixelsPerBeat;

    // Playhead line — slightly brighter, clean 1px
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Playhead triangle indicator
    ctx.fillStyle = 'rgba(224, 224, 224, 0.95)';
    ctx.beginPath();
    ctx.moveTo(x - 4, 0);
    ctx.lineTo(x + 4, 0);
    ctx.lineTo(x, 6);
    ctx.closePath();
    ctx.fill();
}

function drawTakeLanes(ctx: CanvasRenderingContext2D, model: TimelineRenderModel): void {
    const takeState = takeLaneStore.value;
    if (!takeState || takeState.lanes.length === 0) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat, tracks } = model;
    const yOffsets = getTrackYOffsets(tracks);

    for (const lane of takeState.lanes) {
        const trackIndex = tracks.findIndex((t) => t.id === lane.trackId);
        if (trackIndex < 0) {
            continue;
        }

        const trackY = yOffsets[trackIndex]!;
        const h = tracks[trackIndex]!.height;
        const laneHeight = 16;

        for (let i = 0; i < lane.takes.length; i++) {
            const take = lane.takes[i]!;
            const x = (take.startBeat - viewportStartBeat) * pixelsPerBeat;
            const w = (take.endBeat - take.startBeat) * pixelsPerBeat;
            const y = trackY + h - laneHeight * (i + 1) - 2;

            ctx.fillStyle = take.selected ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(x, y, w, laneHeight - 1);

            ctx.strokeStyle = take.selected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, laneHeight - 1);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '7px system-ui';
            ctx.fillText(take.name, x + 2, y + 10, w - 4);
        }

        for (const region of lane.activeCompRegions) {
            const x = (region.startBeat - viewportStartBeat) * pixelsPerBeat;
            const w = (region.endBeat - region.startBeat) * pixelsPerBeat;

            ctx.fillStyle = 'rgba(80, 160, 110, 0.12)';
            ctx.fillRect(x, trackY, w, h);
        }
    }
}

function drawLoopRegion(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, height: number): void {
    const transport = transportStore.value;
    if (!transport?.isLooping) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat } = model;
    const x1 = (transport.loopStart - viewportStartBeat) * pixelsPerBeat;
    const x2 = (transport.loopEnd - viewportStartBeat) * pixelsPerBeat;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x1, 0, x2 - x1, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, height);
    ctx.moveTo(x2, 0);
    ctx.lineTo(x2, height);
    ctx.stroke();
    ctx.setLineDash([]);
}
