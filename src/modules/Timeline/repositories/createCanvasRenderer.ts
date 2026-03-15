import type { TimelineRenderer } from "../models/RendererBackend";
import type { TimelineRenderModel } from "../models/TimelineRenderModel";
import { markerStore } from "../stores/markerStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";

export const createCanvasRenderer = (canvas: HTMLCanvasElement): TimelineRenderer => {
    const ctx = canvas.getContext("2d")!;
    let width = canvas.width;
    let height = canvas.height;

    const render = (model: TimelineRenderModel): void => {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, width * dpr, height * dpr);
        ctx.save();
        ctx.scale(dpr, dpr);

        drawBeatRuler(ctx, model, width);
        drawMarkers(ctx, model, width);
        ctx.save();
        ctx.translate(0, 24);
        const contentHeight = height - 24;
        drawLoopRegion(ctx, model, contentHeight);
        drawGrid(ctx, model, width, contentHeight);
        drawTracks(ctx, model, width);
        drawPlayhead(ctx, model, contentHeight);
        ctx.restore();

        ctx.restore();
    };

    const resize = (w: number, h: number): void => {
        const dpr = window.devicePixelRatio || 1;
        width = w;
        height = h;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    };

    const dispose = (): void => {};

    return { backend: "canvas2d", render, resize, dispose };
};

const drawBeatRuler = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    width: number,
): void => {
    const { pixelsPerBeat, viewportStartBeat, timeSignatureNumerator } = model;
    const startBeat = Math.floor(viewportStartBeat);

    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(0, 0, width, 20);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(width, 20);
    ctx.stroke();

    for (let beat = startBeat; (beat - viewportStartBeat) * pixelsPerBeat < width; beat++) {
        const x = (beat - viewportStartBeat) * pixelsPerBeat;
        const isBarLine = beat % timeSignatureNumerator === 0;

        if (isBarLine) {
            const barNumber = Math.floor(beat / timeSignatureNumerator) + 1;
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.font = "9px system-ui, sans-serif";
            ctx.fillText(String(barNumber), x + 3, 13);

            ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
            ctx.beginPath();
            ctx.moveTo(x, 14);
            ctx.lineTo(x, 20);
            ctx.stroke();
        } else if (pixelsPerBeat > 8) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
            ctx.beginPath();
            ctx.moveTo(x, 16);
            ctx.lineTo(x, 20);
            ctx.stroke();
        }
    }
};

const drawGrid = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    width: number,
    height: number,
): void => {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;

    const { pixelsPerBeat, viewportStartBeat, timeSignatureNumerator } = model;
    const startBeat = Math.floor(viewportStartBeat);

    for (let beat = startBeat; beat * pixelsPerBeat < width + viewportStartBeat * pixelsPerBeat; beat++) {
        const x = (beat - viewportStartBeat) * pixelsPerBeat;
        const isBarLine = beat % timeSignatureNumerator === 0;

        if (isBarLine) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        } else {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
        }

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
};

const drawTracks = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    width: number,
): void => {
    const { tracks, trackHeight } = model;

    for (const track of tracks) {
        const y = track.index * trackHeight;

        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + trackHeight);
        ctx.lineTo(width, y + trackHeight);
        ctx.stroke();

        for (const clip of track.clips) {
            drawClip(ctx, clip, model, y, trackHeight);
        }
    }
};

const drawClip = (
    ctx: CanvasRenderingContext2D,
    clip: import("../models/TimelineRenderModel").ClipRenderModel,
    model: TimelineRenderModel,
    trackY: number,
    trackHeight: number,
): void => {
    const { pixelsPerBeat, viewportStartBeat } = model;
    const x = (clip.startBeat - viewportStartBeat) * pixelsPerBeat;
    const w = (clip.endBeat - clip.startBeat) * pixelsPerBeat;
    const padding = 2;

    ctx.fillStyle = clip.color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(clip.name, x + 4, trackY + 14, w - 8);
};

const drawPlayhead = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    height: number,
): void => {
    const { playheadPosition, viewportStartBeat, pixelsPerBeat } = model;
    const x = (playheadPosition - viewportStartBeat) * pixelsPerBeat;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x - 4, 0);
    ctx.lineTo(x + 4, 0);
    ctx.lineTo(x, 6);
    ctx.closePath();
    ctx.fill();
};

const drawMarkers = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    _width: number,
): void => {
    const state = markerStore.value;
    if (!state) return;

    const { pixelsPerBeat, viewportStartBeat } = model;

    for (const marker of state.markers) {
        const x = (marker.beat - viewportStartBeat) * pixelsPerBeat;
        if (x < -20 || x > _width + 20) continue;

        ctx.fillStyle = marker.color;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x + 6, 10);
        ctx.lineTo(x + 3, 14);
        ctx.lineTo(x, 10);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = "8px system-ui";
        ctx.fillText(marker.name, x + 8, 10);
    }

    for (const section of state.sections) {
        const x1 = (section.startBeat - viewportStartBeat) * pixelsPerBeat;
        const x2 = (section.endBeat - viewportStartBeat) * pixelsPerBeat;

        ctx.fillStyle = section.color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x1, 0, x2 - x1, 20);
        ctx.globalAlpha = 1;

        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "8px system-ui";
        ctx.fillText(section.name, x1 + 4, 10);
    }
};

const drawLoopRegion = (
    ctx: CanvasRenderingContext2D,
    model: TimelineRenderModel,
    height: number,
): void => {
    const transport = transportStore.value;
    if (!transport?.isLooping) return;

    const { pixelsPerBeat, viewportStartBeat } = model;
    const x1 = (transport.loopStart - viewportStartBeat) * pixelsPerBeat;
    const x2 = (transport.loopEnd - viewportStartBeat) * pixelsPerBeat;

    ctx.fillStyle = "rgba(100, 180, 255, 0.06)";
    ctx.fillRect(x1, 0, x2 - x1, height);

    ctx.strokeStyle = "rgba(100, 180, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, height);
    ctx.moveTo(x2, 0);
    ctx.lineTo(x2, height);
    ctx.stroke();
    ctx.setLineDash([]);
};
