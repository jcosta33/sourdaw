/**
 * Clip drawing helpers for the Canvas timeline renderer.
 * Handles clip body, selection, MIDI note preview, waveform peaks,
 * resize handles, fade curves, and loop markers.
 */

import { getCachedAudioBuffer, getCachedAudioBufferWaveformPeaks } from '#/modules/AudioEngine/useCases';

import { type TimelineRenderModel, type ClipRenderModel } from '../../models/TimelineRenderModel';

import { CLIP_LABEL_FILL_STYLE, CLIP_LABEL_FONT, computeClipLabelLayout } from './clipLabel';

export const drawClip = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    trackY: number,
    trackHeight: number,
    // Monotonic frame clock (ms) used only for the "generating" animation. Defaults
    // to performance.now() so existing call sites keep their current behavior; the
    // renderer can pass a single per-frame timestamp to keep clips in lockstep.
    now: number = performance.now()
): void => {
    const { pixelsPerBeat, viewportStartBeat, selectedClipId, selectedClipIds } = model;
    const x = (clip.startBeat - viewportStartBeat) * pixelsPerBeat;
    const w = (clip.endBeat - clip.startBeat) * pixelsPerBeat;
    const padding = 2;
    const isSelected = clip.id === selectedClipId || selectedClipIds.includes(clip.id);
    const isMuted = clip.muted;

    const isGenerating = clip.generating;

    if (isGenerating) {
        ctx.globalAlpha = (Math.sin(now / 150) + 1) * 0.15 + 0.1;
        ctx.fillStyle = clip.color;
        ctx.beginPath();
        ctx.roundRect(x, trackY + padding, w, trackHeight - padding * 2, 3);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = clip.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        const time = now / 1000;
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
    const baseAlpha = (() => {
        if (isGhost) {
            return 0.35;
        }
        if (isMuted) {
            return 0.35;
        }
        return 1;
    })();
    const bodyAlpha = baseAlpha * (isSelected ? 0.85 : 0.55);

    // Flat body fill. (The previous "gradient" had two identical color stops, so
    // it produced a flat fill anyway while allocating a CanvasGradient every frame.)
    // The depth shading below is provided by the real depthGrad overlay.
    ctx.fillStyle = clip.color;
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

    ctx.globalAlpha = (() => {
        if (isGhost) {
            return 0.6;
        }
        if (isMuted) {
            return 0.35;
        }
        return 1;
    })();

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

    // Clip name. Geometry and typography come from the shared `clipLabel`
    // module so the WebGPU backend can rasterise the identical label.
    const labelLayout = computeClipLabelLayout({ clipXCssPx: x, clipWidthCssPx: w, trackYCssPx: trackY });
    if (labelLayout.visible) {
        ctx.fillStyle = CLIP_LABEL_FILL_STYLE;
        ctx.font = CLIP_LABEL_FONT;
        ctx.fillText(clip.name, labelLayout.xCssPx, labelLayout.baselineYCssPx, labelLayout.maxWidthCssPx);
    }

    const typeLabel = (() => {
        if (clip.isLinkedInstance) {
            return `${clip.type === 'midi' ? 'MIDI' : 'AUDIO'} ⧉`;
        } else {
            if (clip.type === 'midi') {
                return 'MIDI';
            } else {
                return 'AUDIO';
            }
        }
    })();
    ctx.fillStyle = clip.isLinkedInstance ? 'rgba(120, 180, 255, 0.5)' : 'rgba(255, 255, 255, 0.25)';
    ctx.font = '7px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    if (w > 50) {
        ctx.fillText(typeLabel, x + 6, trackY + 23, w - 12);
    }

    const cachedAudioBuffer =
        clip.type === 'audio' && clip.audioBufferId ? getCachedAudioBuffer({ bufferId: clip.audioBufferId }) : null;

    if (clip.type === 'midi' && clip.midiNotes.length > 0) {
        drawMidiNotePreview(ctx, clip, x, trackY, w, trackHeight, padding);
    } else if (clip.type === 'audio' && clip.audioBufferId && cachedAudioBuffer) {
        drawWaveformPeaks(ctx, clip, cachedAudioBuffer, model, x, trackY, w, trackHeight, padding);
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
        ctx.moveTo(fadeStartX, y + h);
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
    // Loop once to find the pitch extent. A spread (Math.min(...notes.map()))
    // can blow the call-stack for clips with very many notes, so we never spread.
    for (const node of notes) {
        if (node.pitch < minPitch) {
            minPitch = node.pitch;
        }
        if (node.pitch > maxPitch) {
            maxPitch = node.pitch;
        }
    }
    if (isInline) {
        // When inline, pad the range and ensure at least an octave of visibility.
        minPitch -= 2;
        maxPitch += 2;
        if (maxPitch - minPitch < 12) {
            const center = Math.round((maxPitch + minPitch) / 2);
            minPitch = center - 6;
            maxPitch = center + 6;
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
        for (let index = 0; index <= pitchRange + 1; index++) {
            const ly = contentTop + index * noteHeight;
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
            const relStart = note.startBeat - midiOffset + loopOffset;
            if (relStart >= clipDuration) {
                continue;
            }

            const nx = clipX + (relStart / clipDuration) * clipW;
            const nw = Math.max(isInline ? 2 : 1, (note.duration / clipDuration) * clipW);
            const pitchNorm = (note.pitch - minPitch) / (pitchRange + 1);
            const ny = contentTop + contentHeight - (pitchNorm + 1 / (pitchRange + 1)) * contentHeight;
            const nh = Math.max(1, contentHeight / (pitchRange + 1)) - (isInline ? 1 : 0);

            // Only draw if within clip visual bounds
            if (relStart + note.duration > 0 && nx < clipX + clipW) {
                const finalX = Math.max(nx, clipX);
                const finalW = Math.min(nw - (finalX - nx), clipX + clipW - finalX);

                if (finalW > 0) {
                    if (isInline) {
                        ctx.beginPath();
                        ctx.roundRect(finalX, ny, finalW, nh, 1);
                        ctx.fill();
                        // Note border when inline
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    } else {
                        ctx.fillRect(finalX, ny, finalW, nh);
                    }
                }
            }
        }
        loopOffset += loopLen;
        iterations++;
        if (!clip.loopEnabled || loopLen <= 0) {
            break;
        }
    }

    if (isInline) {
        ctx.shadowBlur = 0;
    }
};

const drawWaveformPeaks = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    buffer: AudioBuffer,
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
    const numBins = Math.min(Math.floor(w), 600);

    // Map clip beats onto audio-buffer samples so trimmed / offset / stretched
    // clips show the actual portion of the sample that will be played, rather
    // than the whole buffer squashed into the clip width.
    const offsetBeats = clip.audioOffsetBeats ?? 0;
    const stretchRatio = clip.stretchRatio ?? 1;
    const clipBeats = clip.endBeat - clip.startBeat;
    const secondsPerBeat = 60 / model.tempo;
    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(offsetBeats * secondsPerBeat * sampleRate));
    const beatsConsumed = clipBeats / Math.max(stretchRatio, 0.0001);
    const endSample = Math.floor(startSample + beatsConsumed * secondsPerBeat * sampleRate);

    const peaks = getCachedAudioBufferWaveformPeaks({
        bufferId: clip.audioBufferId,
        numBins,
        startSample,
        endSample,
    });

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

    const drawBinWidth = w / peaks.length;

    ctx.beginPath();
    ctx.moveTo(x + padding, midY);
    for (let index = 0; index < peaks.length; index++) {
        const peak = peaks[index] ?? 0;
        ctx.lineTo(x + padding + index * drawBinWidth, midY - peak * amplitude);
    }
    for (let index = peaks.length - 1; index >= 0; index--) {
        const peak = peaks[index] ?? 0;
        ctx.lineTo(x + padding + index * drawBinWidth, midY + peak * amplitude);
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
    for (let index = 0; index < steps; index++) {
        const px = x + padding + (index / steps) * (w - padding * 2);
        const seed = Math.sin(px * 0.7) * Math.cos(px * 0.3 + 1.5);
        const h = Math.abs(seed) * amplitude;
        ctx.moveTo(px, midY - h);
        ctx.lineTo(px, midY + h);
    }
    ctx.stroke();
};
