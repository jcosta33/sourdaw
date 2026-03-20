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
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { getAutomationRegions } from '#/modules/Track/transformers/automationTransformers';
import { AUTOMATION_SUB_LANE_HEIGHT } from '../models/automationConstants';

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
    const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1);

    for (const lane of visibleLanes) {
        const trackIndex = tracks.findIndex((t) => t.id === lane.trackId);
        if (trackIndex < 0) {
            continue;
        }

        const track = tracks[trackIndex]!;
        const trackY = yOffsets[trackIndex]!;
        const h = track.height;
        const laneHeight = Math.min(h * 0.5, 60);
        const laneY = trackY + h - laneHeight - 2;
        const range = lane.maxValue - lane.minValue;
        const curveColor = lane.color ?? track.color;
        const isDisabled = lane.enabled === false;

        // Parse color for alpha variations
        const r = parseInt(curveColor.slice(1, 3), 16) || 100;
        const g = parseInt(curveColor.slice(3, 5), 16) || 160;
        const b = parseInt(curveColor.slice(5, 7), 16) || 255;

        const beatToX = (beat: number): number => (beat - viewportStartBeat) * pixelsPerBeat;
        const valueToY = (value: number): number => {
            const norm = range !== 0 ? (value - lane.minValue) / range : 0;
            return laneY + laneHeight - norm * laneHeight;
        };

        // Background fill for lane area
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.03 : 0.06})`;
        ctx.fillRect(0, laneY, canvasWidth, laneHeight);

        // Build path with proper curve interpolation
        const pathPoints: { x: number; y: number }[] = [];

        for (let i = 0; i < lane.points.length; i++) {
            const p = lane.points[i]!;
            const px = beatToX(p.beat);
            const py = valueToY(p.value);

            if (i === 0) {
                pathPoints.push({ x: px, y: py });
                continue;
            }

            const prev = lane.points[i - 1]!;

            if (prev.curve === 'step') {
                pathPoints.push({ x: px, y: valueToY(prev.value) });
                pathPoints.push({ x: px, y: py });
            } else if (prev.curve === 'linear') {
                pathPoints.push({ x: px, y: py });
            } else if (prev.curve === 'stairs') {
                const steps = prev.stairSteps ?? 4;
                for (let s = 0; s < steps; s++) {
                    const t1 = s / steps;
                    const t2 = (s + 1) / steps;
                    const sv = prev.value + (p.value - prev.value) * t1;
                    const sx1 = beatToX(prev.beat) + (px - beatToX(prev.beat)) * t1;
                    const sx2 = beatToX(prev.beat) + (px - beatToX(prev.beat)) * t2;
                    pathPoints.push({ x: sx1, y: valueToY(sv) });
                    pathPoints.push({ x: sx2, y: valueToY(sv) });
                    if (s === steps - 1) {
                        pathPoints.push({ x: sx2, y: py });
                    }
                }
            } else if (prev.curve === 'smooth') {
                // Catmull-Rom subdivision
                const v0 = i >= 2 ? lane.points[i - 2]!.value : prev.value;
                const v1 = prev.value;
                const v2 = p.value;
                const v3 = i < lane.points.length - 1 ? lane.points[i + 1]!.value : p.value;
                const segments = 16;
                const prevX = beatToX(prev.beat);
                for (let s = 1; s <= segments; s++) {
                    const t = s / segments;
                    const t2 = t * t;
                    const t3 = t2 * t;
                    const iv =
                        0.5 *
                        (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
                    pathPoints.push({ x: prevX + (px - prevX) * t, y: valueToY(iv) });
                }
            } else {
                // Exponential / S-curve — subdivide
                const tension = prev.tension ?? 0;
                const segments = 12;
                const prevX = beatToX(prev.beat);
                for (let s = 1; s <= segments; s++) {
                    const t = s / segments;
                    let curved: number;
                    if (prev.curve === 's-curve') {
                        const st = t * t * (3 - 2 * t);
                        curved = t + (st - t) * Math.abs(tension);
                    } else {
                        // Exponential with tension
                        const power = Math.pow(2, tension * 3);
                        curved = Math.pow(t, power);
                    }
                    const iv = prev.value + (p.value - prev.value) * curved;
                    pathPoints.push({ x: prevX + (px - prevX) * t, y: valueToY(iv) });
                }
            }
        }

        if (pathPoints.length < 2) {
            continue;
        }

        // Draw gradient fill under curve
        ctx.beginPath();
        ctx.moveTo(pathPoints[0]!.x, pathPoints[0]!.y);
        for (let i = 1; i < pathPoints.length; i++) {
            ctx.lineTo(pathPoints[i]!.x, pathPoints[i]!.y);
        }
        ctx.lineTo(pathPoints[pathPoints.length - 1]!.x, laneY + laneHeight);
        ctx.lineTo(pathPoints[0]!.x, laneY + laneHeight);
        ctx.closePath();
        const fillAlpha = isDisabled ? 0.04 : 0.12;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha})`;
        ctx.fill();

        // Draw curve line
        ctx.beginPath();
        ctx.moveTo(pathPoints[0]!.x, pathPoints[0]!.y);
        for (let i = 1; i < pathPoints.length; i++) {
            ctx.lineTo(pathPoints[i]!.x, pathPoints[i]!.y);
        }
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.3 : 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isDisabled) {
            ctx.setLineDash([4, 4]);
        }
        ctx.stroke();
        if (isDisabled) {
            ctx.setLineDash([]);
        }

        // Draw breakpoint nodes
        for (const point of lane.points) {
            const px = beatToX(point.beat);
            const py = valueToY(point.value);

            // Outer glow
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();

            // Node fill
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.4 : 0.9})`;
            ctx.beginPath();
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // White stroke
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw trim curve overlay if trim data exists
        if (lane.trimPoints && lane.trimPoints.length >= 2) {
            const trimPathPoints: { x: number; y: number }[] = [];
            for (const tp of lane.trimPoints) {
                const tpx = beatToX(tp.beat);
                // Trim value is an offset from the base curve
                const baseValue = lane.points.reduce((acc, p, idx) => {
                    if (p.beat <= tp.beat) {
                        const next = lane.points[idx + 1];
                        if (next && next.beat >= tp.beat) {
                            const t = (tp.beat - p.beat) / (next.beat - p.beat);
                            return p.value + (next.value - p.value) * t;
                        }
                        return p.value;
                    }
                    return acc;
                }, lane.points[0]?.value ?? 0);
                const combinedValue = Math.max(lane.minValue, Math.min(lane.maxValue, baseValue + tp.value));
                trimPathPoints.push({ x: tpx, y: valueToY(combinedValue) });
            }

            if (trimPathPoints.length >= 2) {
                // Draw combined trim+base curve at full opacity
                ctx.beginPath();
                ctx.moveTo(trimPathPoints[0]!.x, trimPathPoints[0]!.y);
                for (let i = 1; i < trimPathPoints.length; i++) {
                    ctx.lineTo(trimPathPoints[i]!.x, trimPathPoints[i]!.y);
                }
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 1.0)`;
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    }

    // Draw inline automation sub-lanes below tracks
    drawInlineSubLanes(ctx, model, canvasWidth);

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

function drawInlineSubLanes(ctx: CanvasRenderingContext2D, model: TimelineRenderModel, canvasWidth: number): void {
    const autoState = automationStore.value;
    const ws = workspaceStore.value;
    if (!autoState || !ws || ws.automationVisibility === 'hidden') {
        return;
    }

    const subLaneMap = ws.automationSubLanes;
    const { pixelsPerBeat, viewportStartBeat, tracks } = model;
    const yOffsets = getTrackYOffsets(tracks);

    for (let ti = 0; ti < tracks.length; ti++) {
        const track = tracks[ti]!;
        const paramIds = subLaneMap[track.id];
        if (!paramIds || paramIds.length === 0) {
            continue;
        }

        const trackY = yOffsets[ti]!;
        // Base track height = total height minus sub-lane space
        const baseHeight = track.height - paramIds.length * AUTOMATION_SUB_LANE_HEIGHT;

        for (let si = 0; si < paramIds.length; si++) {
            const paramId = paramIds[si]!;
            const lane = autoState.lanes.find((l) => l.trackId === track.id && l.parameterId === paramId);
            if (!lane) {
                // Draw empty sub-lane placeholder
                const slY = trackY + baseHeight + si * AUTOMATION_SUB_LANE_HEIGHT;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
                ctx.fillRect(0, slY, canvasWidth, AUTOMATION_SUB_LANE_HEIGHT);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, slY);
                ctx.lineTo(canvasWidth, slY);
                ctx.stroke();
                // Label
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.font = '9px system-ui';
                ctx.fillText(paramId, 4, slY + 12);
                continue;
            }

            const slY = trackY + baseHeight + si * AUTOMATION_SUB_LANE_HEIGHT;
            const slH = AUTOMATION_SUB_LANE_HEIGHT;
            const range = lane.maxValue - lane.minValue;
            const curveColor = lane.color ?? track.color;
            const isDisabled = lane.enabled === false;

            const r = parseInt(curveColor.slice(1, 3), 16) || 100;
            const g = parseInt(curveColor.slice(3, 5), 16) || 160;
            const b = parseInt(curveColor.slice(5, 7), 16) || 255;

            // Sub-lane separator
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, slY);
            ctx.lineTo(canvasWidth, slY);
            ctx.stroke();

            // Background
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.03)`;
            ctx.fillRect(0, slY, canvasWidth, slH);

            // Parameter label
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
            ctx.font = '9px system-ui';
            ctx.fillText(lane.parameterName, 4, slY + 11);

            if (lane.points.length < 2) {
                continue;
            }

            const beatToX = (beat: number): number => (beat - viewportStartBeat) * pixelsPerBeat;
            const valueToY = (value: number): number => {
                const norm = range !== 0 ? (value - lane.minValue) / range : 0;
                return slY + slH - norm * (slH - 4) - 2;
            };

            // Build curve using virgin territory segments
            const regions = lane.virginTerritory ? getAutomationRegions(lane.points) : [{ startBeat: -Infinity, endBeat: Infinity }];

            for (const region of regions) {
                const regionPts = lane.points.filter((p) =>
                    p.beat >= region.startBeat && p.beat <= region.endBeat
                );
                if (regionPts.length < 2) {
                    continue;
                }

                // Build path
                const pathPoints: { x: number; y: number }[] = [];
                for (let i = 0; i < regionPts.length; i++) {
                    const p = regionPts[i]!;
                    const px = beatToX(p.beat);
                    const py = valueToY(p.value);

                    if (i === 0) {
                        pathPoints.push({ x: px, y: py });
                        continue;
                    }

                    const prev = regionPts[i - 1]!;
                    if (prev.curve === 'step') {
                        pathPoints.push({ x: px, y: valueToY(prev.value) });
                        pathPoints.push({ x: px, y: py });
                    } else if (prev.curve === 'linear') {
                        pathPoints.push({ x: px, y: py });
                    } else {
                        // Subdivision for smooth/exp/s-curve/stairs
                        const segments = 12;
                        const prevX = beatToX(prev.beat);
                        for (let s = 1; s <= segments; s++) {
                            const t = s / segments;
                            let iv: number;
                            if (prev.curve === 'stairs') {
                                const steps = prev.stairSteps ?? 4;
                                const st = Math.floor(t * steps) / steps;
                                iv = prev.value + (p.value - prev.value) * st;
                            } else if (prev.curve === 'smooth') {
                                const v0 = i >= 2 ? regionPts[i - 2]?.value ?? prev.value : prev.value;
                                const v1 = prev.value;
                                const v2 = p.value;
                                const v3 = i < regionPts.length - 1 ? regionPts[i + 1]?.value ?? p.value : p.value;
                                const t2 = t * t;
                                const t3 = t2 * t;
                                iv = 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
                            } else {
                                const tension = prev.tension ?? 0;
                                if (prev.curve === 's-curve') {
                                    const st = t * t * (3 - 2 * t);
                                    const curved = t + (st - t) * Math.abs(tension);
                                    iv = prev.value + (p.value - prev.value) * curved;
                                } else {
                                    const power = Math.pow(2, tension * 3);
                                    iv = prev.value + (p.value - prev.value) * Math.pow(t, power);
                                }
                            }
                            pathPoints.push({ x: prevX + (px - prevX) * t, y: valueToY(iv) });
                        }
                    }
                }

                if (pathPoints.length < 2) {
                    continue;
                }

                // Gradient fill
                ctx.beginPath();
                ctx.moveTo(pathPoints[0]!.x, pathPoints[0]!.y);
                for (let i = 1; i < pathPoints.length; i++) {
                    ctx.lineTo(pathPoints[i]!.x, pathPoints[i]!.y);
                }
                ctx.lineTo(pathPoints[pathPoints.length - 1]!.x, slY + slH);
                ctx.lineTo(pathPoints[0]!.x, slY + slH);
                ctx.closePath();
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.04 : 0.1})`;
                ctx.fill();

                // Curve line
                ctx.beginPath();
                ctx.moveTo(pathPoints[0]!.x, pathPoints[0]!.y);
                for (let i = 1; i < pathPoints.length; i++) {
                    ctx.lineTo(pathPoints[i]!.x, pathPoints[i]!.y);
                }
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.3 : 0.8})`;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (isDisabled) {
                    ctx.setLineDash([4, 4]);
                }
                ctx.stroke();
                if (isDisabled) {
                    ctx.setLineDash([]);
                }
            }

            // Breakpoint nodes
            for (const point of lane.points) {
                const px = beatToX(point.beat);
                const py = valueToY(point.value);
                if (px < -10 || px > canvasWidth + 10) {
                    continue;
                }

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
                ctx.beginPath();
                ctx.arc(px, py, 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${isDisabled ? 0.4 : 0.9})`;
                ctx.beginPath();
                ctx.arc(px, py, 2.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 0.75;
                ctx.beginPath();
                ctx.arc(px, py, 2.5, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }
}
