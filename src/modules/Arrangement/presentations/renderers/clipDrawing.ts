/**
 * Clip drawing helpers for the Canvas timeline renderer.
 * Handles clip body, selection, MIDI note preview, waveform peaks,
 * resize handles, fade curves, and loop markers.
 */

import { type TimelineRenderModel, type ClipRenderModel } from '../../models/TimelineRenderModel';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

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

    // Clip body fill with subtle vertical gradient for dimensionality
    const clipY = trackY + padding;
    const clipH = trackHeight - padding * 2;
    const baseAlpha = isGhost ? 0.35 : isMuted ? 0.35 : 1;
    const bodyAlpha = baseAlpha * (isSelected ? 0.85 : 0.55);

    // Create a gradient that darkens slightly toward the bottom for depth
    const bodyGrad = ctx.createLinearGradient(0, clipY, 0, clipY + clipH);
    bodyGrad.addColorStop(0, clip.color);
    bodyGrad.addColorStop(1, clip.color);
    ctx.fillStyle = bodyGrad;
    ctx.globalAlpha = bodyAlpha;
    ctx.beginPath();
    ctx.roundRect(x, clipY, w, clipH, 3);
    ctx.fill();

    // Subtle darkening overlay toward bottom edge for depth
    const depthGrad = ctx.createLinearGradient(0, clipY, 0, clipY + clipH);
    depthGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
    depthGrad.addColorStop(0.3, 'transparent');
    depthGrad.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
    ctx.fillStyle = depthGrad;
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.roundRect(x, clipY, w, clipH, 3);
    ctx.fill();

    ctx.globalAlpha = isGhost ? 0.6 : isMuted ? 0.35 : 1;

    // Top-edge highlight for dimensional "lit from above" effect
    if (!isGhost && !isMuted && w > 8) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 3, clipY + 0.5);
        ctx.lineTo(x + w - 3, clipY + 0.5);
        ctx.stroke();
    }

    if (isGhost) {
        // Ghost clips get a dashed purple border
        ctx.strokeStyle = 'rgba(128, 104, 152, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(x, clipY, w, clipH, 3);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (clip.isLinkedInstance) {
        ctx.strokeStyle = 'rgba(120, 180, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.roundRect(x, clipY, w, clipH, 3);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (isSelected) {
        ctx.strokeStyle = 'rgba(220, 210, 190, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, clipY, w, clipH, 3);
        ctx.stroke();
    } else {
        // Subtle border: slightly brighter top-left, darker bottom-right
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(x, clipY, w, clipH, 3);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    ctx.fillText(clip.name, x + 6, trackY + 14, w - 12);

    const typeLabel = clip.isLinkedInstance
        ? `${clip.type === 'midi' ? 'MIDI' : 'AUDIO'} ⧉`
        : clip.type === 'midi'
          ? 'MIDI'
          : 'AUDIO';
    ctx.fillStyle = clip.isLinkedInstance ? 'rgba(120, 180, 255, 0.5)' : 'rgba(255, 255, 255, 0.25)';
    ctx.font = '7px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    if (w > 50) {
        ctx.fillText(typeLabel, x + 6, trackY + 23, w - 12);
    }

    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
        drawMidiNotePreview(ctx, clip, x, trackY, w, trackHeight, padding);
    } else if (clip.type === 'audio' && clip.audioBufferId && audioBufferCache.has(clip.audioBufferId)) {
        drawWaveformPeaks(ctx, clip, model, x, trackY, w, trackHeight, padding);
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

    const isInline = clip.isInlineEditing ?? false;

    let minPitch = 127;
    let maxPitch = 0;
    if (isInline) {
        // When inline, use a fixed range or a reasonable default if notes are sparse
        minPitch = Math.min(...notes.map(n => n.pitch)) - 2;
        maxPitch = Math.max(...notes.map(n => n.pitch)) + 2;
        // Ensure at least an octave range for visibility
        if (maxPitch - minPitch < 12) {
            const center = Math.round((maxPitch + minPitch) / 2);
            minPitch = center - 6;
            maxPitch = center + 6;
        }
    } else {
        for (const n of notes) {
            if (n.pitch < minPitch) minPitch = n.pitch;
            if (n.pitch > maxPitch) maxPitch = n.pitch;
        }
    }
    const pitchRange = Math.max(maxPitch - minPitch, 1);

    const contentTop = trackY + (isInline ? padding : 18);
    const contentHeight = trackHeight - padding - (isInline ? padding : 18);
    if (contentHeight < 4) {
        return;
    }

    const clipDuration = clip.endBeat - clip.startBeat;
    if (clipDuration <= 0) {
        return;
    }

    if (isInline) {
        // Draw inline piano roll grid
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(clipX, contentTop, clipW, contentHeight);

        // Horizontal lines for pitches
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 0.5;
        const noteHeight = contentHeight / (pitchRange + 1);
        for (let i = 0; i <= pitchRange + 1; i++) {
            const ly = contentTop + i * noteHeight;
            ctx.beginPath();
            ctx.moveTo(clipX, ly);
            ctx.lineTo(clipX + clipW, ly);
            ctx.stroke();
        }
    }

    ctx.fillStyle = isInline ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.22)';
    if (isInline) {
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
    }

    const loopLen = clip.loopEnabled && clip.loopLength ? clip.loopLength : clipDuration;
    const midiOffset = clip.midiOffsetBeats ?? 0;
    let loopOffset = 0;
    let iterations = 0;

    while (loopOffset < clipDuration && iterations < 100) {
        for (const note of notes) {
            const relStart = (note.startBeat - midiOffset) - clip.startBeat + loopOffset;
            if (relStart >= clipDuration) continue;

            const nx = clipX + (relStart / clipDuration) * clipW;
            const nw = Math.max(isInline ? 2 : 1, (note.duration / clipDuration) * clipW);
            const pitchNorm = (note.pitch - minPitch) / (pitchRange + 1);
            const ny = contentTop + contentHeight - (pitchNorm + 1 / (pitchRange + 1)) * contentHeight;
            const nh = Math.max(1, contentHeight / (pitchRange + 1)) - (isInline ? 1 : 0);

            // Only draw if within clip visual bounds
            if (relStart + note.duration > 0 && nx < clipX + clipW) {
                const drawW = Math.min(nw, clipX + clipW - nx);
                if (isInline) {
                    ctx.beginPath();
                    ctx.roundRect(nx, ny, drawW, nh, 1);
                    ctx.fill();
                    // Note border when inline
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                } else {
                    ctx.fillRect(nx, ny, drawW, nh);
                }
            }
        }
        loopOffset += loopLen;
        iterations++;
        if (!clip.loopEnabled || loopLen <= 0) break;
    }

    if (isInline) {
        ctx.shadowBlur = 0;
    }
};

const drawWaveformPeaks = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    x: number,
    trackY: number,
    w: number,
    trackHeight: number,
    padding: number
): void => {
    if (w < 4 || !clip.audioBufferId) {
        return;
    }
    const audioBufferId = clip.audioBufferId;
    const numBins = Math.min(Math.floor(w), 600);

    // R-A10: Implement waveform slip by shifting the index into peaks array.
    // getWaveformPeaks returns peaks for the whole buffer.
    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) return;

    const bpm = model.tempo;
    const totalBeats = (buffer.length / buffer.sampleRate) * (bpm / 60);
    const audioOffset = clip.audioOffsetBeats ?? 0;
    
    // How many beats are visible in this clip
    const visibleBeats = clip.endBeat - clip.startBeat;
    
    // We want to sample 'numBins' from the buffer starting at 'audioOffset' and spanning 'visibleBeats'.
    // audioBufferCache.getWaveformPeaks is too simple for this.
    // For now, let's just draw the full buffer peaks and translate/clip them.
    const peaks = audioBufferCache.getWaveformPeaks(audioBufferId, Math.round(numBins * (totalBeats / visibleBeats)));

    const midY = trackY + trackHeight / 2 + 4;

    const amplitude = (trackHeight - padding * 2) * 0.35;

    ctx.save();
    // Clip to clip bounds
    ctx.beginPath();
    ctx.rect(x + padding, trackY + padding, w - padding * 2, trackHeight - padding * 2);
    ctx.clip();

    const waveGrad = ctx.createLinearGradient(0, midY - amplitude, 0, midY + amplitude);
    waveGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    waveGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.12)');
    waveGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
    waveGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0.12)');
    waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0.28)');
    ctx.fillStyle = waveGrad;

    const startIdx = Math.max(0, Math.floor((audioOffset / totalBeats) * peaks.length));
    const binsToDraw = Math.floor((visibleBeats / totalBeats) * peaks.length);
    const drawBinWidth = w / binsToDraw;

    ctx.beginPath();
    ctx.moveTo(x + padding, midY);
    for (let i = 0; i < binsToDraw; i++) {
        const peak = peaks[startIdx + i] ?? 0;
        ctx.lineTo(x + padding + i * drawBinWidth, midY - peak * amplitude);
    }
    for (let i = binsToDraw - 1; i >= 0; i--) {
        const peak = peaks[startIdx + i] ?? 0;
        ctx.lineTo(x + padding + i * drawBinWidth, midY + peak * amplitude);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
