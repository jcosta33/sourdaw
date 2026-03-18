import { type TimelineRenderer } from '../models/RendererBackend';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';
import { markerStore } from '../stores/markerStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { getTimeSignatureAtBeat } from '#/modules/Transport/useCases/transportQueries';
import { takeLaneStore } from '#/modules/Track/stores/takeLaneStore';
import { drawClip } from '../helpers/clipDrawing';


export function createCanvasRenderer(canvas: HTMLCanvasElement): TimelineRenderer {
    const ctx = canvas.getContext('2d')!;
    let width = canvas.width;
    let height = canvas.height;

    function render(model: TimelineRenderModel): void {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, width * dpr, height * dpr);
        ctx.save();
        ctx.scale(dpr, dpr);

        drawBeatRuler(ctx, model, width);
        drawTempoMap(ctx, model, width);
        drawMarkers(ctx, model, width);
        ctx.save();
        ctx.translate(0, 24);
        const contentHeight = height - 24;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, contentHeight);
        ctx.clip();
        ctx.translate(0, -model.scrollY);
        drawLoopRegion(ctx, model, contentHeight + model.scrollY);
        drawGrid(ctx, model, width, contentHeight + model.scrollY);
        drawTracks(ctx, model, width);
        drawTakeLanes(ctx, model);
        drawAutomation(ctx, model, contentHeight + model.scrollY);
        drawPlayhead(ctx, model, contentHeight + model.scrollY);
        ctx.restore();
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

function drawBeatRuler(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, width: number): void {
    const { pixelsPerBeat, viewportStartBeat, timeSignatureNumerator, timeSignatureDenominator } = model;
    const startBeat = Math.floor(viewportStartBeat);
    const tsChanges = timeSignatureMapStore.value?.changes ?? [];

    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(0, 0, width, 20);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(width, 20);
    ctx.stroke();

    let barNumber = 1;
    let barStartBeat = 0;
    let currentNumerator = timeSignatureNumerator;

    for (const change of [...tsChanges].sort((a, b) => a.beat - b.beat)) {
        if (change.beat >= startBeat) {
            break;
        }
        const beatsInSegment = change.beat - barStartBeat;
        barNumber += Math.floor(beatsInSegment / currentNumerator);
        barStartBeat = change.beat;
        currentNumerator = change.numerator;
    }
    const beatsToStart = startBeat - barStartBeat;
    barNumber += Math.floor(beatsToStart / currentNumerator);
    barStartBeat += Math.floor(beatsToStart / currentNumerator) * currentNumerator;

    for (let beat = startBeat; (beat - viewportStartBeat) * pixelsPerBeat < width; beat++) {
        const x = (beat - viewportStartBeat) * pixelsPerBeat;
        const ts = getTimeSignatureAtBeat(tsChanges, beat, timeSignatureNumerator, timeSignatureDenominator);

        const tsChange = tsChanges.find((c) => c.beat === beat);
        if (tsChange) {
            barStartBeat = beat;
            currentNumerator = tsChange.numerator;
        }

        const beatInBar = (beat - barStartBeat) % currentNumerator;
        const isBarLine = beatInBar === 0;

        if (isBarLine) {
            if (beat > startBeat || beatInBar === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.font = '9px system-ui, sans-serif';
                ctx.fillText(String(barNumber), x + 3, 13);
            }

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.moveTo(x, 14);
            ctx.lineTo(x, 20);
            ctx.stroke();

            barNumber++;
        } else if (pixelsPerBeat > 8) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath();
            ctx.moveTo(x, 16);
            ctx.lineTo(x, 20);
            ctx.stroke();
        }

        void ts;
    }

    for (const change of tsChanges) {
        const x = (change.beat - viewportStartBeat) * pixelsPerBeat;
        if (x < -20 || x > width + 20) {
            continue;
        }

        ctx.fillStyle = 'rgba(100, 200, 255, 0.8)';
        ctx.font = '7px system-ui';
        ctx.fillText(`${change.numerator}/${change.denominator}`, x + 2, 8);
    }
}

function drawGrid(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, width: number, height: number): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

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
        void beatsInSegment;
        barStartBeat = change.beat;
        currentNumerator = change.numerator;
    }

    for (let beat = startBeat; beat * pixelsPerBeat < width + viewportStartBeat * pixelsPerBeat; beat++) {
        const x = (beat - viewportStartBeat) * pixelsPerBeat;

        const tsChange = tsChanges.find((c) => c.beat === beat);
        if (tsChange) {
            barStartBeat = beat;
            currentNumerator = tsChange.numerator;
        }

        const isBarLine = (beat - barStartBeat) % currentNumerator === 0;

        if (isBarLine) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        }

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    void timeSignatureDenominator;
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
        const h = track.height;
        const isSelected = track.id === selectedTrackId;
        const isEven = track.index % 2 === 0;

        if (isSelected) {
            ctx.fillStyle = 'rgba(100, 160, 255, 0.08)';
        } else if (isEven) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
        }
        ctx.fillRect(0, y, width, h);

        ctx.fillStyle = track.color;
        ctx.globalAlpha = isSelected ? 0.5 : 0.25;
        ctx.fillRect(0, y, 3, h);
        ctx.globalAlpha = 1;

        if (track.muted) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(0, y, width, h);
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + h);
        ctx.lineTo(width, y + h);
        ctx.stroke();

        if (isSelected) {
            ctx.strokeStyle = 'rgba(100, 160, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.font = '9px system-ui, sans-serif';
        const kindLabel = TRACK_KIND_LABELS[track.kind] ?? '';
        if (track.clips.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.fillText(`${track.name}  ·  ${kindLabel}`, 8, y + h / 2 + 3);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.font = '8px system-ui, sans-serif';
            ctx.fillText('Drop audio/MIDI here or use Draw tool', 8, y + h / 2 + 14);
        }

        for (const clip of track.clips) {
            drawClip(ctx, clip, model, y, h);
        }
    }
}



function drawPlayhead(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, height: number): void {
    const { playheadPosition, viewportStartBeat, pixelsPerBeat } = model;
    const x = (playheadPosition - viewportStartBeat) * pixelsPerBeat;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(x - 4, 0);
    ctx.lineTo(x + 4, 0);
    ctx.lineTo(x, 6);
    ctx.closePath();
    ctx.fill();
}

function drawMarkers(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, _width: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat } = model;

    for (const marker of state.markers) {
        const x = (marker.beat - viewportStartBeat) * pixelsPerBeat;
        if (x < -20 || x > _width + 20) {
            continue;
        }

        ctx.fillStyle = marker.color;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x + 6, 10);
        ctx.lineTo(x + 3, 14);
        ctx.lineTo(x, 10);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '8px system-ui';
        ctx.fillText(marker.name, x + 8, 10);
    }

    for (const section of state.sections) {
        const x1 = (section.startBeat - viewportStartBeat) * pixelsPerBeat;
        const x2 = (section.endBeat - viewportStartBeat) * pixelsPerBeat;

        ctx.fillStyle = section.color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x1, 0, x2 - x1, 20);
        ctx.globalAlpha = 1;

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '8px system-ui';
        ctx.fillText(section.name, x1 + 4, 10);
    }
}

function drawTempoMap(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, width: number): void {
    const tempoState = tempoMapStore.value;
    if (!tempoState || tempoState.changes.length === 0) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat } = model;

    for (const change of tempoState.changes) {
        const x = (change.beat - viewportStartBeat) * pixelsPerBeat;
        if (x < -20 || x > width + 20) {
            continue;
        }

        ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, 14);
        ctx.lineTo(x, 20);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
        ctx.font = '7px system-ui';
        ctx.fillText(`${change.tempo}`, x + 2, 19);
    }
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

            ctx.fillStyle = take.selected ? 'rgba(100, 200, 255, 0.3)' : 'rgba(100, 200, 255, 0.1)';
            ctx.fillRect(x, y, w, laneHeight - 1);

            ctx.strokeStyle = take.selected ? 'rgba(100, 200, 255, 0.6)' : 'rgba(100, 200, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, laneHeight - 1);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '7px system-ui';
            ctx.fillText(take.name, x + 2, y + 10, w - 4);
        }

        for (const region of lane.activeCompRegions) {
            const x = (region.startBeat - viewportStartBeat) * pixelsPerBeat;
            const w = (region.endBeat - region.startBeat) * pixelsPerBeat;

            ctx.fillStyle = 'rgba(100, 255, 150, 0.15)';
            ctx.fillRect(x, trackY, w, h);
        }
    }
}

function drawAutomation(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, contentHeight: number): void {
    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat, tracks } = model;
    const yOffsets = getTrackYOffsets(tracks);
    const visibleLanes = autoState.lanes.filter((l) => l.visible && l.points.length >= 2);

    for (const lane of visibleLanes) {
        const trackIndex = tracks.findIndex((t) => t.id === lane.trackId);
        if (trackIndex < 0) {
            continue;
        }

        const trackY = yOffsets[trackIndex]!;
        const h = tracks[trackIndex]!.height;
        const laneHeight = h * 0.4;
        const laneY = trackY + h - laneHeight - 2;

        ctx.fillStyle = 'rgba(255, 180, 50, 0.08)';
        ctx.fillRect(0, laneY, ctx.canvas.width / (window.devicePixelRatio || 1), laneHeight);

        ctx.strokeStyle = 'rgba(255, 180, 50, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        const range = lane.maxValue - lane.minValue;

        let started = false;
        for (const point of lane.points) {
            const px = (point.beat - viewportStartBeat) * pixelsPerBeat;
            const normalizedValue = range !== 0 ? (point.value - lane.minValue) / range : 0;
            const py = laneY + laneHeight - normalizedValue * laneHeight;

            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();

        for (const point of lane.points) {
            const px = (point.beat - viewportStartBeat) * pixelsPerBeat;
            const normalizedValue = range !== 0 ? (point.value - lane.minValue) / range : 0;
            const py = laneY + laneHeight - normalizedValue * laneHeight;

            ctx.fillStyle = 'rgba(255, 180, 50, 0.9)';
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    void contentHeight;
}

function drawLoopRegion(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, height: number): void {
    const transport = transportStore.value;
    if (!transport?.isLooping) {
        return;
    }

    const { pixelsPerBeat, viewportStartBeat } = model;
    const x1 = (transport.loopStart - viewportStartBeat) * pixelsPerBeat;
    const x2 = (transport.loopEnd - viewportStartBeat) * pixelsPerBeat;

    ctx.fillStyle = 'rgba(100, 180, 255, 0.06)';
    ctx.fillRect(x1, 0, x2 - x1, height);

    ctx.strokeStyle = 'rgba(100, 180, 255, 0.3)';
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
