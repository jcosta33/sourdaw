/**
 * Canvas drawing hook for the PianoRoll editor.
 *
 * Owns all Canvas 2D drawing logic: grid, ruler, ghost notes, active notes,
 * step input cursor, draw preview, rubber-band selection, and lasso path.
 */
import { type RefObject, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';
import { type MidiNote } from '#/modules/MIDI/useCases/midi';
import {
    NOTE_NAMES,
    GRID_BEATS,
    ROW_HEIGHT,
    RULER_HEIGHT,
    SCALES,
    getVisiblePitches,
    colorWithAlpha,
    brightenColor,
} from '../helpers/pianoRollConstants';

type RendererDeps = {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    notes: MidiNote[];
    clipId: string;
    trackId: string;
    beatWidth: number;
    gridSnap: number;
    scaleType: string;
    scaleRoot: number;
    isFolded: boolean;
    selectedNoteIds: Set<string>;
    stepInput: boolean;
    stepBeat: number;
    showGhostNotes: boolean;
    /** MIDI state — notesByClipId map */
    midiNotesByClipId: Record<string, MidiNote[]> | null;
    /** Track state — track list */
    tracks: Array<{ id: string; kind: string; color: string; clips: Array<{ id: string; type: string; color: string }> }> | null;
    /** Current draw preview (drag-to-create) */
    drawPreviewRef: RefObject<{ beat: number; pitch: number; duration: number } | null | null>;
    /** Active rubber band selection rectangle */
    rubberBandRef: RefObject<{ x: number; y: number; w: number; h: number } | null | null>;
    /** Ephemeral drag preview — avoids flooding midiStore during note move/resize */
    dragPreviewRef: RefObject<{
        noteIds: Set<string>;
        beatDelta: number;
        pitchDelta: number;
        /** For resize-right: duration override per note id */
        durationOverride?: Map<string, number>;
        /** For resize-left: beat and duration overrides per note id */
        beatOverride?: Map<string, { beat: number; duration: number }>;
    } | null>;
};

export const usePianoRollRenderer = (deps: RendererDeps): (() => void) => {
    const {
        canvasRef,
        notes,
        clipId,
        trackId,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot,
        isFolded,
        selectedNoteIds,
        stepInput,
        stepBeat,
        showGhostNotes,
        midiNotesByClipId,
        tracks,
        drawPreviewRef,
        rubberBandRef,
        dragPreviewRef,
    } = deps;

    const draw = (): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);

        const noteAreaHeight = visiblePitches.length * ROW_HEIGHT;
        const width = canvas.parentElement?.clientWidth ?? GRID_BEATS * beatWidth;
        const height = noteAreaHeight + RULER_HEIGHT;
        canvas.width = Math.max(width, GRID_BEATS * beatWidth) * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${Math.max(width, GRID_BEATS * beatWidth)}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        const totalWidth = Math.max(width, GRID_BEATS * beatWidth);

        // Background
        ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
        ctx.fillRect(0, 0, totalWidth, height);

        drawBeatRuler(ctx, totalWidth, beatWidth, gridSnap);
        ctx.save();
        ctx.translate(0, RULER_HEIGHT);
        drawNoteGrid(ctx, visiblePitches, totalWidth, beatWidth, gridSnap, scaleType, scaleRoot);
        if (showGhostNotes && tracks) {
            drawGhostNotes(ctx, visiblePitches, beatWidth, midiNotesByClipId, tracks, trackId, clipId);
        }
        drawActiveNotes(ctx, visiblePitches, notes, beatWidth, selectedNoteIds, tracks, trackId, clipId, dragPreviewRef.current);
        if (stepInput) {
            drawStepCursor(ctx, stepBeat, beatWidth, gridSnap, noteAreaHeight);
        }
        drawPreview(ctx, visiblePitches, beatWidth, drawPreviewRef.current);
        drawRubberBand(ctx, rubberBandRef.current);
        ctx.restore();
    };

    useEffect(() => {
        draw();
    }, [
        notes,
        clipId,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot,
        stepInput,
        stepBeat,
        showGhostNotes,
        tracks,
        trackId,
        midiNotesByClipId,
        isFolded,
        selectedNoteIds,
    ]);

    return draw;
};

// ── Drawing helpers ──────────────────────────────────────────────────

function drawBeatRuler(ctx: CanvasRenderingContext2D, totalWidth: number, beatWidth: number, gridSnap: number): void {
    ctx.fillStyle = resolveToken('--color-bg-panel', '#111111');
    ctx.fillRect(0, 0, totalWidth, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(totalWidth, RULER_HEIGHT);
    ctx.stroke();

    const totalBeats = Math.ceil(totalWidth / beatWidth);
    for (let beat = 0; beat <= totalBeats; beat++) {
        const x = beat * beatWidth;
        const isBar = beat % 4 === 0;
        if (isBar) {
            const barNum = Math.floor(beat / 4) + 1;
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 9px system-ui';
            ctx.fillText(String(barNum), x + 3, 12);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.beginPath();
            ctx.moveTo(x, 14);
            ctx.lineTo(x, RULER_HEIGHT);
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            ctx.moveTo(x, 16);
            ctx.lineTo(x, RULER_HEIGHT);
            ctx.stroke();
        }
        if (gridSnap < 1) {
            const subdivisions = Math.round(1 / gridSnap);
            for (let sub = 1; sub < subdivisions; sub++) {
                const sx = x + (sub * beatWidth) / subdivisions;
                ctx.strokeStyle = 'rgba(255,255,255,0.04)';
                ctx.beginPath();
                ctx.moveTo(sx, 19);
                ctx.lineTo(sx, RULER_HEIGHT);
                ctx.stroke();
            }
        }
    }
}

function drawNoteGrid(
    ctx: CanvasRenderingContext2D,
    visiblePitches: number[],
    totalWidth: number,
    beatWidth: number,
    gridSnap: number,
    scaleType: string,
    scaleRoot: number
): void {
    const scaleIntervals = SCALES[scaleType] ?? SCALES.chromatic!;

    for (let row = 0; row < visiblePitches.length; row++) {
        const pitch = visiblePitches[row]!;
        const noteIndex = pitch % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
        const y = row * ROW_HEIGHT;

        if (isBlack) {
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.fillRect(0, y, totalWidth, ROW_HEIGHT);
        }

        const relativeNote = (noteIndex - scaleRoot + 12) % 12;
        if (!scaleIntervals.includes(relativeNote)) {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(0, y, totalWidth, ROW_HEIGHT);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(0, y + ROW_HEIGHT);
        ctx.lineTo(totalWidth, y + ROW_HEIGHT);
        ctx.stroke();

        if (noteIndex === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_HEIGHT);
            ctx.lineTo(totalWidth, y + ROW_HEIGHT);
            ctx.stroke();
        }
    }

    const noteAreaHeight = visiblePitches.length * ROW_HEIGHT;
    const totalBeats = Math.ceil(totalWidth / beatWidth);
    for (let beat = 0; beat <= totalBeats; beat++) {
        const x = beat * beatWidth;
        ctx.strokeStyle = beat % 4 === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, noteAreaHeight);
        ctx.stroke();

        if (gridSnap < 1) {
            const subdivisions = Math.round(1 / gridSnap);
            for (let sub = 1; sub < subdivisions; sub++) {
                const sx = x + (sub * beatWidth) / subdivisions;
                ctx.strokeStyle = 'rgba(255,255,255,0.02)';
                ctx.beginPath();
                ctx.moveTo(sx, 0);
                ctx.lineTo(sx, noteAreaHeight);
                ctx.stroke();
            }
        }
    }
}

function drawGhostNotes(
    ctx: CanvasRenderingContext2D,
    visiblePitches: number[],
    beatWidth: number,
    midiNotesByClipId: Record<string, MidiNote[]> | null,
    tracks: Array<{ id: string; kind: string; color: string; clips: Array<{ id: string; type: string; color: string }> }>,
    trackId: string,
    clipId: string
): void {
    // Ghost notes from other MIDI tracks
    const otherMidiTracks = tracks.filter((t) => t.kind === 'midi' && t.id !== trackId);
    for (const otherTrack of otherMidiTracks) {
        for (const otherClip of otherTrack.clips) {
            if (otherClip.type !== 'midi') {
                continue;
            }
            const otherNotes = midiNotesByClipId?.[otherClip.id];
            if (!otherNotes) {
                continue;
            }
            const ghostClipColor = otherClip.color || otherTrack.color;
            for (const gn of otherNotes) {
                drawGhostNote(ctx, visiblePitches, beatWidth, gn, ghostClipColor, 0.06, 0.10);
            }
        }
    }

    // Ghost notes from non-selected clips on the same track
    const activeTrack = tracks.find((t) => t.id === trackId);
    if (activeTrack) {
        for (const sameTrackClip of activeTrack.clips) {
            if (sameTrackClip.id === clipId || sameTrackClip.type !== 'midi') {
                continue;
            }
            const ghostNotes = midiNotesByClipId?.[sameTrackClip.id];
            if (!ghostNotes) {
                continue;
            }
            const ghostColor = sameTrackClip.color || activeTrack.color;
            for (const gn of ghostNotes) {
                drawGhostNote(ctx, visiblePitches, beatWidth, gn, ghostColor, 0.08, 0.12);
            }
        }
    }
}

function drawGhostNote(
    ctx: CanvasRenderingContext2D,
    visiblePitches: number[],
    beatWidth: number,
    note: MidiNote,
    color: string,
    fillAlpha: number,
    strokeAlpha: number
): void {
    const row = visiblePitches.indexOf(note.pitch);
    if (row === -1) {
        return;
    }
    const x = note.startBeat * beatWidth;
    const y = row * ROW_HEIGHT;
    const w = note.duration * beatWidth;

    ctx.fillStyle = colorWithAlpha(color, fillAlpha);
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
    ctx.fill();

    ctx.strokeStyle = colorWithAlpha(color, strokeAlpha);
    ctx.lineWidth = 0.5;
    ctx.stroke();
}

type DragPreview = {
    noteIds: Set<string>;
    beatDelta: number;
    pitchDelta: number;
    durationOverride?: Map<string, number>;
    beatOverride?: Map<string, { beat: number; duration: number }>;
} | null;

function drawActiveNotes(
    ctx: CanvasRenderingContext2D,
    visiblePitches: number[],
    notes: MidiNote[],
    beatWidth: number,
    selectedNoteIds: Set<string>,
    tracks: Array<{ id: string; kind: string; color: string; clips: Array<{ id: string; type: string; color: string }> }> | null,
    trackId: string,
    clipId: string,
    dragPreview: DragPreview = null
): void {
    const activeTrack = tracks?.find((t) => t.id === trackId);
    const activeClip = activeTrack?.clips.find((c) => c.id === clipId);
    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';
    const selectedColor = brightenColor(clipColor, 0.22);

    for (const note of notes) {
        // Apply ephemeral drag preview offsets without touching the store
        let displayPitch = note.pitch;
        let displayStartBeat = note.startBeat;
        let displayDuration = note.duration;
        if (dragPreview && dragPreview.noteIds.has(note.id)) {
            if (dragPreview.beatOverride?.has(note.id)) {
                const override = dragPreview.beatOverride.get(note.id)!;
                displayStartBeat = override.beat;
                displayDuration = override.duration;
            } else if (dragPreview.durationOverride?.has(note.id)) {
                displayDuration = dragPreview.durationOverride.get(note.id)!;
            } else {
                displayStartBeat = Math.max(0, note.startBeat + dragPreview.beatDelta);
                displayPitch = Math.max(0, Math.min(127, note.pitch + dragPreview.pitchDelta));
            }
        }

        const row = visiblePitches.indexOf(displayPitch);
        if (row === -1) {
            continue;
        }
        const x = displayStartBeat * beatWidth;
        const y = row * ROW_HEIGHT;
        const w = displayDuration * beatWidth;

        const isSelected = selectedNoteIds.has(note.id);
        const alpha = 0.4 + (note.velocity / 127) * 0.6;
        const noteColor = isSelected ? selectedColor : clipColor;

        ctx.fillStyle = colorWithAlpha(noteColor, alpha);
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
        ctx.fill();

        if (isSelected) {
            ctx.strokeStyle = colorWithAlpha(selectedColor, 0.7);
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Velocity bar
        const velH = Math.max(1, (note.velocity / 127) * (ROW_HEIGHT - 4));
        ctx.fillStyle = colorWithAlpha(noteColor, isSelected ? 0.3 : 0.25);
        ctx.fillRect(x + 2, y + ROW_HEIGHT - 2 - velH, Math.max(2, w - 4), velH);

        // Resize handles
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(x + 1, y + 1, 4, ROW_HEIGHT - 2);
        ctx.fillRect(x + w - 5, y + 1, 4, ROW_HEIGHT - 2);

        // Note label
        if (w > 20) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '9px system-ui';
            ctx.fillText(`${NOTE_NAMES[displayPitch % 12]}${Math.floor(displayPitch / 12) - 1}`, x + 6, y + 11);
        }
    }
}

function drawStepCursor(
    ctx: CanvasRenderingContext2D,
    stepBeat: number,
    beatWidth: number,
    gridSnap: number,
    noteAreaHeight: number
): void {
    const sx = stepBeat * beatWidth;
    ctx.strokeStyle = 'rgba(160, 90, 120, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, noteAreaHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    ctx.fillStyle = 'rgba(160, 90, 120, 0.06)';
    const stepW = gridSnap * beatWidth;
    ctx.fillRect(sx, 0, stepW, noteAreaHeight);
}

function drawPreview(
    ctx: CanvasRenderingContext2D,
    visiblePitches: number[],
    beatWidth: number,
    preview: { beat: number; pitch: number; duration: number } | null
): void {
    if (!preview) {
        return;
    }
    const dpRow = visiblePitches.indexOf(preview.pitch);
    if (dpRow === -1) {
        return;
    }
    const dpX = preview.beat * beatWidth;
    const dpY = dpRow * ROW_HEIGHT;
    const dpW = preview.duration * beatWidth;

    ctx.fillStyle = 'rgba(200, 190, 170, 0.3)';
    ctx.beginPath();
    ctx.roundRect(dpX + 1, dpY + 1, Math.max(4, dpW - 2), ROW_HEIGHT - 2, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 190, 170, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawRubberBand(
    ctx: CanvasRenderingContext2D,
    rb: { x: number; y: number; w: number; h: number } | null
): void {
    if (!rb) {
        return;
    }
    ctx.fillStyle = 'rgba(180, 170, 160, 0.12)';
    ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
    ctx.strokeStyle = 'rgba(180, 170, 160, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rb.x, rb.y, rb.w, rb.h);
    ctx.setLineDash([]);
}
