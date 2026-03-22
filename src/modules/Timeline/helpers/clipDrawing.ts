/**
 * Clip drawing helpers for the Canvas timeline renderer.
 * Handles clip body, selection, MIDI note preview, waveform peaks,
 * resize handles, fade curves, and loop markers.
 */

import { type TimelineRenderModel, type ClipRenderModel } from '../models/TimelineRenderModel';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';

export const drawClip = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    trackY: number,
    trackHeight: number
): void => {
    const { pixelsPerBeat, viewportStartBeat, selectedClipId, selectedClipIds } = model;
    const x = (clip.startBeat - viewportStartBeat) * pixelsPerBeat;
    const w = (clip.endBeat - clip.startBeat) * pixelsPerBeat;
    const padding = 2;
    const isSelected = clip.id === selectedClipId || selectedClipIds.includes(clip.id);
    const isMuted = clip.muted;

    const isGenerating = clip.generating;

    if (isGenerating) {
        ctx.globalAlpha = (Math.sin(Date.now() / 150) + 1) * 0.15 + 0.1;
        ctx.fillStyle = clip.color;
        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = clip.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        const time = Date.now() / 1000;
        ctx.lineDashOffset = -time * 20;

        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'italic 10px system-ui, sans-serif';
        ctx.fillText('Generating...', x + 6, trackY + 14, w - 12);
        return;
    }

    if (isMuted) {
        ctx.globalAlpha = 0.35;
    }

    // Ghost clip: AI-generated preview, 40% opacity with purple dashed border
    const isGhost = clip.isGhost ?? false;
    if (isGhost) {
        ctx.globalAlpha = 0.4;
    }

    ctx.fillStyle = clip.color;
    const baseAlpha = isGhost ? 0.35 : isMuted ? 0.35 : 1;
    ctx.globalAlpha = baseAlpha * (isSelected ? 0.75 : 0.55);
    ctx.beginPath();
    ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
    ctx.fill();
    ctx.globalAlpha = isGhost ? 0.6 : isMuted ? 0.35 : 1;

    if (isGhost) {
        // Ghost clips get a dashed purple border
        ctx.strokeStyle = 'rgba(128, 104, 152, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (isSelected) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.stroke();
    } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText(clip.name, x + 6, trackY + 14, w - 12);

    const typeLabel = clip.type === 'midi' ? 'MIDI' : 'AUDIO';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '7px system-ui, sans-serif';
    if (w > 50) {
        ctx.fillText(typeLabel, x + 6, trackY + 23, w - 12);
    }

    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
        drawMidiNotePreview(ctx, clip, x, trackY, w, trackHeight, padding);
    } else if (clip.type === 'audio' && clip.audioBufferId && audioBufferCache.has(clip.audioBufferId)) {
        drawWaveformPeaks(ctx, clip.audioBufferId, x, trackY, w, trackHeight, padding);
    } else if (w > 20) {
        drawWaveformHint(ctx, x, trackY, w, trackHeight, padding);
    }

    if (clip.loopEnabled) {
        drawClipLoopMarkers(ctx, clip, model, x, trackY, w, trackHeight, padding);
    }

    drawFadeCurves(ctx, clip, model, x, trackY, w, trackHeight, padding);

    if (isSelected && w > 16) {
        drawResizeHandles(ctx, x, trackY + padding, w, trackHeight - padding * 2);
    }

    if (isMuted || isGhost) {
        ctx.globalAlpha = 1;
    }
};

const drawClipLoopMarkers = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    clipX: number,
    trackY: number,
    clipW: number,
    trackHeight: number,
    padding: number
): void => {
    const clipLength = clip.endBeat - clip.startBeat;
    const loopLen = clip.loopLength ?? clipLength;
    if (loopLen <= 0 || loopLen >= clipLength) {
        drawLoopIcon(ctx, clipX, trackY, clipW, padding);
        return;
    }

    const { pixelsPerBeat } = model;
    const loopPixels = loopLen * pixelsPerBeat;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    let markerX = clipX + loopPixels;
    while (markerX < clipX + clipW) {
        ctx.beginPath();
        ctx.moveTo(markerX, trackY + padding);
        ctx.lineTo(markerX, trackY + trackHeight - padding);
        ctx.stroke();
        markerX += loopPixels;
    }

    ctx.setLineDash([]);

    drawLoopIcon(ctx, clipX, trackY, clipW, padding);
};

const drawLoopIcon = (
    ctx: CanvasRenderingContext2D,
    clipX: number,
    trackY: number,
    clipW: number,
    padding: number
): void => {
    if (clipW < 30) {
        return;
    }

    const iconX = clipX + clipW - 16;
    const iconY = trackY + padding + 3;
    const size = 8;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(iconX + size / 2, iconY + size / 2, size / 2, Math.PI * 0.8, Math.PI * 2.2);
    ctx.stroke();

    const arrowX = iconX + size * 0.85;
    const arrowY = iconY + size * 0.15;
    ctx.beginPath();
    ctx.moveTo(arrowX - 2, arrowY - 2);
    ctx.lineTo(arrowX, arrowY);
    ctx.lineTo(arrowX - 2, arrowY + 2);
    ctx.stroke();
};

export const drawResizeHandles = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void => {
    const handleW = 4;
    const handleH = Math.min(h * 0.4, 16);
    const handleY = y + (h - handleH) / 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x + 1, handleY, handleW, handleH, 1);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(x + w - handleW - 1, handleY, handleW, handleH, 1);
    ctx.fill();
};

const drawFadeCurves = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    clipX: number,
    trackY: number,
    clipW: number,
    trackHeight: number,
    padding: number
): void => {
    const { pixelsPerBeat } = model;
    const y = trackY + padding;
    const h = trackHeight - padding * 2;

    if (clip.fadeInBeats > 0) {
        const fadeInPx = Math.min(clip.fadeInBeats * pixelsPerBeat, clipW);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.moveTo(clipX, y);
        ctx.lineTo(clipX + fadeInPx, y);
        ctx.lineTo(clipX, y + h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(clipX, y + h);
        ctx.lineTo(clipX + fadeInPx, y);
        ctx.stroke();
    }

    if (clip.fadeOutBeats > 0) {
        const fadeOutPx = Math.min(clip.fadeOutBeats * pixelsPerBeat, clipW);
        const fadeStartX = clipX + clipW - fadeOutPx;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.moveTo(fadeStartX, y);
        ctx.lineTo(clipX + clipW, y);
        ctx.lineTo(clipX + clipW, y + h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fadeStartX, y);
        ctx.lineTo(clipX + clipW, y + h);
        ctx.stroke();
    }
};

const drawMidiNotePreview = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    clipX: number,
    trackY: number,
    clipW: number,
    trackHeight: number,
    padding: number
): void => {
    const notes = clip.midiNotes;
    if (notes.length === 0) {
        return;
    }

    let minPitch = 127;
    let maxPitch = 0;
    for (const n of notes) {
        if (n.pitch < minPitch) {
            minPitch = n.pitch;
        }
        if (n.pitch > maxPitch) {
            maxPitch = n.pitch;
        }
    }
    const pitchRange = Math.max(maxPitch - minPitch, 1);

    const contentTop = trackY + 18;
    const contentHeight = trackHeight - padding - 18;
    if (contentHeight < 4) {
        return;
    }

    const clipDuration = clip.endBeat - clip.startBeat;
    if (clipDuration <= 0) {
        return;
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (const note of notes) {
        const relStart = note.startBeat - clip.startBeat;
        const nx = clipX + (relStart / clipDuration) * clipW;
        const nw = Math.max(1, (note.duration / clipDuration) * clipW);
        const pitchNorm = (note.pitch - minPitch) / pitchRange;
        const ny = contentTop + contentHeight - pitchNorm * contentHeight - 2;
        ctx.fillRect(nx, ny, nw, Math.max(1, contentHeight / (pitchRange + 4)));
    }
};

const drawWaveformPeaks = (
    ctx: CanvasRenderingContext2D,
    audioBufferId: string,
    x: number,
    trackY: number,
    w: number,
    trackHeight: number,
    padding: number
): void => {
    if (w < 4) {
        return;
    }
    const numBins = Math.min(Math.floor(w), 400);
    const peaks = audioBufferCache.getWaveformPeaks(audioBufferId, numBins);

    const midY = trackY + trackHeight / 2 + 4;
    const amplitude = (trackHeight - padding * 2) * 0.35;
    const binWidth = w / numBins;

    ctx.fillStyle = 'rgba(106, 158, 128, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x + padding, midY);
    for (let i = 0; i < numBins; i++) {
        ctx.lineTo(x + padding + i * binWidth, midY - peaks[i]! * amplitude);
    }
    ctx.lineTo(x + padding + (numBins - 1) * binWidth, midY);
    for (let i = numBins - 1; i >= 0; i--) {
        ctx.lineTo(x + padding + i * binWidth, midY + peaks[i]! * amplitude);
    }
    ctx.closePath();
    ctx.fill();
};

const drawWaveformHint = (
    ctx: CanvasRenderingContext2D,
    x: number,
    trackY: number,
    w: number,
    trackHeight: number,
    padding: number
): void => {
    if (w < 10) {
        return;
    }
    const midY = trackY + trackHeight / 2 + 4;
    const amplitude = (trackHeight - padding * 2) * 0.25;
    const steps = Math.min(Math.floor(w / 2), 80);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
        const px = x + padding + (i / steps) * (w - padding * 2);
        const seed = Math.sin(px * 0.7) * Math.cos(px * 0.3 + 1.5);
        const h = Math.abs(seed) * amplitude;
        ctx.moveTo(px, midY - h);
        ctx.lineTo(px, midY + h);
    }
    ctx.stroke();
};
