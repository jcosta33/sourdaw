/**
 * Canvas drawing hook for the PianoRoll editor.
 *
 * ## Architecture — AnimationScheduler + OffscreenCanvas grid cache
 *
 * This hook previously called `draw()` inside a `useEffect`, which meant every
 * React re-render (triggered by `useStore` subscriptions on midiStore / trackStore)
 * forced a full canvas repaint through React's reconciler. That caused
 * frame-pacing issues: dragging notes → React re-renders → useEffect fires →
 * canvas redraws — all serialised through the JS event loop.
 *
 * The new design decouples rendering from React entirely:
 *
 * 1. **rAF loop** — runs independently at 60-120fps. Reads midiStore and
 *    trackStore directly via reference equality checks. Skips the repaint when
 *    nothing has changed.
 *
 * 2. **OffscreenCanvas grid cache** — the static beat grid, ruler, and row
 *    backgrounds are drawn once to an OffscreenCanvas and bitblit-ted onto the
 *    main canvas every frame. The grid is only rebuilt when beat width, snap,
 *    scale, fold state, or canvas dimensions change — eliminating thousands of
 *    `moveTo`/`lineTo` path strokes per frame.
 *
 * 3. **Ref-based layout props** — all layout/config props are synchronously
 *    mirrored into refs each render so the rAF closure always reads the current
 *    value without needing to be re-created.
 *
 * 4. **Exposed `draw()`** — the synchronous draw function is still returned so
 *    interaction handlers can request an immediate repaint (e.g. on mousemove
 *    during drag) without waiting for the next rAF tick.
 *
 * ## The canvas covers the viewport, not the arrangement
 *
 * The backing store spans the visible viewport only — the scroll container's
 * `clientWidth` minus the sticky pitch rail — and every layer is drawn
 * translated by the container's `scrollLeft`, so canvas x `0` is the beat at
 * the left edge of the viewport rather than beat zero. The element itself is
 * `position: sticky` at the rail's right edge inside a wrapper that carries
 * the full content width (`PianoRoll.tsx`), so CSS layout owns the scroll
 * extent and the canvas never has to.
 *
 * This is what keeps every beat reachable at every zoom. A backing store sized
 * to the whole arrangement made the reachable beat count inversely
 * proportional to zoom by construction: a canvas dimension is finite, so
 * `beats * beatWidth * devicePixelRatio` had to fit inside it, and any budget
 * on that product could only choose which of the two to sacrifice. Nothing
 * here may reintroduce a dependency between the content extent and the
 * backing store — the two are different measurements of different things.
 *
 * Because the drawn window moves with the scroll offset, the scroll offset is
 * part of what decides a repaint (`scrollDirty`) *and* part of the grid cache
 * key. The cache covers a window wider than the viewport and is rebuilt only
 * when scrolling leaves that window, so scrolling costs a blit and the dynamic
 * layers rather than a full grid re-stroke per frame.
 */
import { type RefObject, useRef, useEffect, useLayoutEffect } from 'react';

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { resolveToken } from '#/utils/UI/resolveToken';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import {
    NOTE_NAMES,
    ROW_HEIGHT,
    RULER_HEIGHT,
    SCALES,
    EMPTY_NOTES,
    PITCH_RAIL_WIDTH,
    getVisiblePitches,
    colorWithAlpha,
    brightenColor,
} from '../helpers/pianoRollConstants';

/**
 * Extra grid cached either side of the viewport, as a fraction of the viewport
 * width. The cache is rebuilt only when scrolling leaves the cached window, so
 * this trades backing-store memory for grid re-strokes: at 0.5 the cache is
 * two viewports wide and a rebuild happens once per half-viewport of travel
 * instead of once per frame.
 */
const GRID_CACHE_MARGIN_RATIO = 0.5;

/** Visible horizontal slice of the arrangement, in content pixels. */
type ViewportRange = { leftPx: number; rightPx: number };

/** True when a note's painted span overlaps the visible slice at all. */
function isSpanVisible(startBeat: number, duration: number, beatWidth: number, view: ViewportRange): boolean {
    const startPx = startBeat * beatWidth;
    return startPx <= view.rightPx && startPx + duration * beatWidth >= view.leftPx;
}

type RendererDeps = {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    /**
     * The `overflow-auto` scroll container that owns the piano roll's scroll
     * position. Its `scrollLeft` is the drawing origin and its `clientWidth`
     * (minus `PITCH_RAIL_WIDTH`) is the width the backing store is sized to.
     * Read live inside the rAF loop rather than mirrored through React state,
     * so the drawn offset can never lag the browser's own scroll by a frame.
     */
    scrollRef: RefObject<HTMLElement | null>;
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
    stepPitch: number;
    showGhostNotes: boolean;
    /** A9: additional clip IDs open simultaneously in the piano roll */
    openedClipIds?: string[];
    /** Current draw preview (drag-to-create) */
    drawPreviewRef: RefObject<{ beat: number; pitch: number; duration: number } | null>;
    /** Active rubber band selection rectangle */
    rubberBandRef: RefObject<{ x: number; y: number; w: number; h: number } | null>;
    /** Ephemeral drag preview — avoids flooding midiStore during note move/resize */
    dragPreviewRef: RefObject<{
        noteIds: Set<string>;
        beatDelta: number;
        pitchDelta: number;
        durationOverride?: Map<string, number>;
        beatOverride?: Map<string, { beat: number; duration: number }>;
    } | null>;
};

export const usePianoRollRenderer = (deps: RendererDeps): (() => void) => {
    // ── Mirror all layout/config props into refs so the rAF loop always
    //    reads the current value without being re-created on every render. ──
    const beatWidthRef = useRef(deps.beatWidth);
    const gridSnapRef = useRef(deps.gridSnap);
    const scaleTypeRef = useRef(deps.scaleType);
    const scaleRootRef = useRef(deps.scaleRoot);
    const isFoldedRef = useRef(deps.isFolded);
    const selectedNoteIdsRef = useRef(deps.selectedNoteIds);
    const stepInputRef = useRef(deps.stepInput);
    const stepBeatRef = useRef(deps.stepBeat);
    const stepPitchRef = useRef(deps.stepPitch);
    const showGhostNotesRef = useRef(deps.showGhostNotes);
    const clipIdRef = useRef(deps.clipId);
    const trackIdRef = useRef(deps.trackId);
    const openedClipIdsRef = useRef(deps.openedClipIds ?? []);

    // Sync props into refs after every render so the rAF closure always sees
    // the latest values. useLayoutEffect runs synchronously before the browser
    // paints, ensuring refs are current before the next animation frame fires.
    useLayoutEffect(() => {
        beatWidthRef.current = deps.beatWidth;
        gridSnapRef.current = deps.gridSnap;
        scaleTypeRef.current = deps.scaleType;
        scaleRootRef.current = deps.scaleRoot;
        isFoldedRef.current = deps.isFolded;
        selectedNoteIdsRef.current = deps.selectedNoteIds;
        stepInputRef.current = deps.stepInput;
        stepBeatRef.current = deps.stepBeat;
        stepPitchRef.current = deps.stepPitch;
        showGhostNotesRef.current = deps.showGhostNotes;
        clipIdRef.current = deps.clipId;
        trackIdRef.current = deps.trackId;
        openedClipIdsRef.current = deps.openedClipIds ?? [];
    });

    // ── OffscreenCanvas grid cache ──────────────────────────────────────
    const gridCacheRef = useRef<OffscreenCanvas | null>(null);
    // String key of the layout params that were used to draw the cached grid.
    const gridCacheKeyRef = useRef('');
    // Left edge of the cached window, in whole device pixels of content space.
    // -1 means "no window cached yet", which no real offset can equal.
    const gridWindowStartRef = useRef(-1);

    // ── Change-detection sentinels ───────────────────────────────────────
    const prevNotesRef = useRef<MidiNote[] | null>(null);
    const prevMidiStateRef = useRef<object | null>(null);
    const prevTracksRef = useRef<object | null>(null);
    const prevSelIdsRef = useRef<Set<string> | null>(null);
    const prevDragRef = useRef<unknown>(undefined);
    const prevDrawPreviewRef = useRef<unknown>(undefined);
    const prevRubberRef = useRef<unknown>(undefined);
    const prevGhostRef = useRef<boolean | null>(null);
    const prevScrollRef = useRef<number | null>(null);

    // ── Stable draw() ref — updated each rAF tick ───────────────────────
    const drawFnRef = useRef<() => void>(() => {});

    useEffect(() => {
        let rafId = 0;

        const tick = (): void => {
            const canvas = deps.canvasRef.current;
            if (!canvas) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                rafId = requestAnimationFrame(tick);
                return;
            }

            // Read current layout props from refs
            const bw = beatWidthRef.current;
            const gs = gridSnapRef.current;
            const st = scaleTypeRef.current;
            const sr = scaleRootRef.current;
            const folded = isFoldedRef.current;
            const cId = clipIdRef.current;
            const tId = trackIdRef.current;
            const si = stepInputRef.current;
            const sb = stepBeatRef.current;
            const sp = stepPitchRef.current;
            const ghost = showGhostNotesRef.current;
            const selIds = selectedNoteIdsRef.current;

            // Read store state
            const midiState = midiStore.value;
            const trackState = trackStore.value;
            const notes = midiState?.notesByClipId[cId] ?? EMPTY_NOTES;
            const tracks = trackState?.tracks ?? null;
            const openedIds = openedClipIdsRef.current;

            const dpr = window.devicePixelRatio || 1;
            const visiblePitches = getVisiblePitches(st, sr, folded);
            // Build O(1) pitch→row lookup to avoid indexOf scans in draw passes
            const pitchToRow = new Map<number, number>();
            for (let index = 0; index < visiblePitches.length; index++) {
                pitchToRow.set(visiblePitches[index]!, index);
            }
            const noteAreaHeight = visiblePitches.length * ROW_HEIGHT;
            const height = noteAreaHeight + RULER_HEIGHT;

            // ── Viewport, not content extent ─────────────────────────────
            // The backing store covers what is on screen. The content extent
            // lives in CSS on the wrapper around this canvas (PianoRoll.tsx)
            // and never reaches the backing store, so no amount of content at
            // any zoom can push a beat outside it.
            const scrollEl = deps.scrollRef.current;
            const viewportWidth = (scrollEl?.clientWidth ?? 0) - PITCH_RAIL_WIDTH;
            if (viewportWidth <= 0) {
                // Not laid out yet (or the editor is collapsed to nothing).
                // There is no visible slice to draw, so skip the frame rather
                // than sizing the backing store from a bogus measurement.
                rafId = requestAnimationFrame(tick);
                return;
            }

            // Resize canvas backing store only when dimensions change
            const targetW = Math.round(viewportWidth * dpr);
            const targetH = Math.round(height * dpr);
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
                canvas.style.width = `${viewportWidth}px`;
                canvas.style.height = `${height}px`;
            }

            // Scroll offset snapped to whole device pixels, so the cached grid
            // blit and the dynamic layers share one origin instead of drifting
            // a fraction of a pixel apart while scrolling.
            const scrollDevicePx = Math.max(0, Math.round((scrollEl?.scrollLeft ?? 0) * dpr));
            const scrollPx = scrollDevicePx / dpr;
            const view: ViewportRange = { leftPx: scrollPx, rightPx: scrollPx + viewportWidth };

            // ── Grid cache window ────────────────────────────────────────
            // The cache spans a window wider than the viewport; scrolling
            // inside it costs only a blit. Leaving it — or changing any layout
            // input — rebuilds it around the new offset.
            const marginDevicePx = Math.round(targetW * GRID_CACHE_MARGIN_RATIO);
            const cacheDeviceWidth = targetW + marginDevicePx * 2;
            const gridKey = `${bw}|${gs}|${st}|${sr}|${folded}|${targetW}|${targetH}|${dpr}`;
            const cachedWindowStart = gridWindowStartRef.current;
            const gridDirty =
                gridKey !== gridCacheKeyRef.current ||
                cachedWindowStart < 0 ||
                scrollDevicePx < cachedWindowStart ||
                scrollDevicePx + targetW > cachedWindowStart + cacheDeviceWidth;
            const windowStartDevicePx = gridDirty ? Math.max(0, scrollDevicePx - marginDevicePx) : cachedWindowStart;
            const scrollDirty = scrollDevicePx !== prevScrollRef.current;

            // Check data dirty state
            const notesDirty = notes !== prevNotesRef.current;
            const midiDirty = midiState !== prevMidiStateRef.current;
            const tracksDirty = trackState !== prevTracksRef.current;
            const selDirty = selIds !== prevSelIdsRef.current;
            const dragDirty = deps.dragPreviewRef.current !== prevDragRef.current;
            const drawDirty = deps.drawPreviewRef.current !== prevDrawPreviewRef.current;
            const rubberDirty = deps.rubberBandRef.current !== prevRubberRef.current;
            // Ghost-note toggle is a boolean input to the render loop; without a
            // dirty flag, turning ghost notes off while nothing else changes
            // leaves them drawn on the cached dynamic layer until the next
            // unrelated invalidation.
            const ghostDirty = ghost !== prevGhostRef.current;

            // The drawn window moves with the scroll offset, so a scroll that
            // stays inside the cached grid window still has to repaint — every
            // layer sits at a new canvas-local x. Leaving this out would freeze
            // the picture (or smear the dynamic layers over a stale grid) for
            // as long as nothing else happened to invalidate the frame.
            const needsRepaint =
                gridDirty ||
                scrollDirty ||
                notesDirty ||
                midiDirty ||
                tracksDirty ||
                selDirty ||
                dragDirty ||
                drawDirty ||
                rubberDirty ||
                ghostDirty;

            if (needsRepaint) {
                // Update sentinels
                prevNotesRef.current = notes;
                prevMidiStateRef.current = midiState;
                prevTracksRef.current = trackState;
                prevSelIdsRef.current = selIds;
                prevDragRef.current = deps.dragPreviewRef.current;
                prevDrawPreviewRef.current = deps.drawPreviewRef.current;
                prevRubberRef.current = deps.rubberBandRef.current;
                prevGhostRef.current = ghost;
                prevScrollRef.current = scrollDevicePx;

                // Rebuild the grid cache when layout changed or the scroll
                // offset left the cached window.
                if (gridDirty) {
                    const cached = gridCacheRef.current;
                    const offscreen =
                        cached && cached.width === cacheDeviceWidth && cached.height === targetH
                            ? cached
                            : new OffscreenCanvas(cacheDeviceWidth, targetH);
                    const gCtx = offscreen.getContext('2d')!;
                    const windowStartPx = windowStartDevicePx / dpr;
                    const cacheWidth = cacheDeviceWidth / dpr;
                    // Opaque background over the whole cache, drawn before the
                    // content translate so a reused offscreen needs no clear.
                    gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    drawBackground(gCtx, cacheWidth, height);
                    // From here the cache draws in content coordinates.
                    gCtx.translate(-windowStartPx, 0);
                    drawBeatRuler(gCtx, windowStartPx, cacheWidth, bw, gs);
                    gCtx.save();
                    gCtx.translate(0, RULER_HEIGHT);
                    drawNoteGrid(gCtx, visiblePitches, windowStartPx, cacheWidth, bw, gs, st, sr);
                    gCtx.restore();
                    gridCacheRef.current = offscreen;
                    gridCacheKeyRef.current = gridKey;
                    gridWindowStartRef.current = windowStartDevicePx;
                }

                // Reset transform before blitting (canvas resize clears it)
                ctx.setTransform(1, 0, 0, 1, 0, 0);

                // Blit the cached grid at its own content origin, expressed in
                // this frame's canvas-local device pixels.
                ctx.drawImage(gridCacheRef.current!, windowStartDevicePx - scrollDevicePx, 0);

                // Scale for HiDPI and shift the origin to the first visible
                // beat, so every dynamic layer below keeps drawing in absolute
                // content coordinates.
                ctx.setTransform(dpr, 0, 0, dpr, -scrollDevicePx, 0);

                // Ghost notes + secondary open clips + active notes + overlays
                ctx.save();
                ctx.translate(0, RULER_HEIGHT);
                if (ghost && tracks) {
                    drawGhostNotes(ctx, pitchToRow, bw, midiState?.notesByClipId ?? null, tracks, tId, cId, view);
                }
                // A9: draw notes from other simultaneously-open clips at 55% opacity
                if (openedIds.length > 0 && midiState && tracks) {
                    drawOpenedClipNotes(
                        ctx,
                        pitchToRow,
                        bw,
                        midiState.notesByClipId,
                        tracks,
                        cId,
                        openedIds,
                        selIds,
                        view
                    );
                }
                drawActiveNotes(
                    ctx,
                    pitchToRow,
                    notes,
                    bw,
                    selIds,
                    tracks,
                    tId,
                    cId,
                    view,
                    deps.dragPreviewRef.current
                );
                if (si) {
                    drawStepCursor(ctx, pitchToRow, sb, sp, bw, gs, view, noteAreaHeight);
                }
                drawPreview(ctx, pitchToRow, bw, deps.drawPreviewRef.current);
                drawRubberBand(ctx, deps.rubberBandRef.current);
                ctx.restore();
            }

            rafId = requestAnimationFrame(tick);
        };

        // Also wire up the exposed draw() for synchronous interaction repaints.
        // This bypasses the dirty check so interactions get immediate visual
        // feedback without waiting for the next tick.
        drawFnRef.current = (): void => {
            // Invalidate all sentinels so the next tick always repaints.
            prevNotesRef.current = null;
            prevDragRef.current = undefined;
            prevDrawPreviewRef.current = undefined;
            prevRubberRef.current = undefined;
            prevSelIdsRef.current = null;
            prevGhostRef.current = null;
            prevScrollRef.current = null;
        };

        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Intentionally empty — all deps are read via refs inside the loop.

    // eslint-disable-next-line react-hooks/refs -- returning stable draw() ref is intentional; value is set once in useEffect
    return drawFnRef.current;
};

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawBackground(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
    ctx.fillRect(0, 0, width, height);
}

/**
 * Draws the ruler across `[startPx, startPx + widthPx)` of content space. The
 * caller has already translated the context to content coordinates, so the
 * loop below runs over the beats in that slice rather than from beat zero —
 * the window may start anywhere in the arrangement.
 */
function drawBeatRuler(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    startPx: number,
    widthPx: number,
    beatWidth: number,
    gridSnap: number
): void {
    const endPx = startPx + widthPx;
    ctx.fillStyle = resolveToken('--color-bg-panel', '#111111');
    ctx.fillRect(startPx, 0, widthPx, RULER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(startPx, RULER_HEIGHT);
    ctx.lineTo(endPx, RULER_HEIGHT);
    ctx.stroke();

    const firstBeat = Math.max(0, Math.floor(startPx / beatWidth));
    const lastBeat = Math.ceil(endPx / beatWidth);
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
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

/** Row shading and beat lines across `[startPx, startPx + widthPx)`. */
function drawNoteGrid(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    visiblePitches: number[],
    startPx: number,
    widthPx: number,
    beatWidth: number,
    gridSnap: number,
    scaleType: string,
    scaleRoot: number
): void {
    const scaleIntervals = SCALES[scaleType] ?? SCALES.chromatic!;
    const endPx = startPx + widthPx;

    for (let row = 0; row < visiblePitches.length; row++) {
        const pitch = visiblePitches[row]!;
        const noteIndex = pitch % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
        const y = row * ROW_HEIGHT;

        if (isBlack) {
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.fillRect(startPx, y, widthPx, ROW_HEIGHT);
        }

        const relativeNote = (noteIndex - scaleRoot + 12) % 12;
        if (!scaleIntervals.includes(relativeNote)) {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(startPx, y, widthPx, ROW_HEIGHT);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(startPx, y + ROW_HEIGHT);
        ctx.lineTo(endPx, y + ROW_HEIGHT);
        ctx.stroke();

        if (noteIndex === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.moveTo(startPx, y + ROW_HEIGHT);
            ctx.lineTo(endPx, y + ROW_HEIGHT);
            ctx.stroke();
        }
    }

    const noteAreaHeight = visiblePitches.length * ROW_HEIGHT;
    const firstBeat = Math.max(0, Math.floor(startPx / beatWidth));
    const lastBeat = Math.ceil(endPx / beatWidth);
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
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
    pitchToRow: Map<number, number>,
    beatWidth: number,
    midiNotesByClipId: Record<string, MidiNote[]> | null,
    tracks: Array<{
        id: string;
        kind: string;
        color: string;
        clips: Array<{ id: string; type: string; color: string }>;
    }>,
    trackId: string,
    clipId: string,
    view: ViewportRange
): void {
    const otherMidiTracks = tracks.filter((time) => time.kind === 'midi' && time.id !== trackId);
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
                drawGhostNote(ctx, pitchToRow, beatWidth, gn, ghostClipColor, 0.06, 0.1, view);
            }
        }
    }

    const activeTrack = tracks.find((time) => time.id === trackId);
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
                drawGhostNote(ctx, pitchToRow, beatWidth, gn, ghostColor, 0.08, 0.12, view);
            }
        }
    }
}

function drawGhostNote(
    ctx: CanvasRenderingContext2D,
    pitchToRow: Map<number, number>,
    beatWidth: number,
    note: MidiNote,
    color: string,
    fillAlpha: number,
    strokeAlpha: number,
    view: ViewportRange
): void {
    const row = pitchToRow.get(note.pitch) ?? -1;
    if (row === -1) {
        return;
    }
    if (!isSpanVisible(note.startBeat, note.duration, beatWidth, view)) {
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

/**
 * A9: Draw notes from other clips that are simultaneously open in the piano roll.
 * These notes are editable (not read-only ghost notes) so they render at higher opacity.
 */
function drawOpenedClipNotes(
    ctx: CanvasRenderingContext2D,
    pitchToRow: Map<number, number>,
    beatWidth: number,
    notesByClipId: Record<string, MidiNote[]>,
    tracks: Array<{
        id: string;
        kind: string;
        color: string;
        clips: Array<{ id: string; type: string; color: string }>;
    }>,
    primaryClipId: string,
    openedClipIds: string[],
    selectedNoteIds: Set<string>,
    view: ViewportRange
): void {
    for (const openedId of openedClipIds) {
        if (openedId === primaryClipId) {
            continue;
        }
        const openedNotes = notesByClipId[openedId];
        if (!openedNotes) {
            continue;
        }
        // Find the clip color from tracks
        let clipColor = 'oklch(0.7 0.12 250)'; // default blue-ish
        for (const track of tracks) {
            const clip = track.clips.find((context) => context.id === openedId);
            if (clip) {
                clipColor = clip.color || track.color;
                break;
            }
        }
        for (const note of openedNotes) {
            const row = pitchToRow.get(note.pitch) ?? -1;
            if (row === -1) {
                continue;
            }
            if (!isSpanVisible(note.startBeat, note.duration, beatWidth, view)) {
                continue;
            }
            const x = note.startBeat * beatWidth;
            const y = row * ROW_HEIGHT;
            const w = note.duration * beatWidth;
            const isSelected = selectedNoteIds.has(note.id);
            const fillAlpha = isSelected ? 0.75 : 0.5;
            const strokeAlpha = isSelected ? 0.9 : 0.65;
            ctx.fillStyle = colorWithAlpha(clipColor, fillAlpha);
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
            ctx.fill();
            ctx.strokeStyle = colorWithAlpha(clipColor, strokeAlpha);
            ctx.lineWidth = isSelected ? 1 : 0.5;
            ctx.stroke();
        }
    }
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
    pitchToRow: Map<number, number>,
    notes: MidiNote[],
    beatWidth: number,
    selectedNoteIds: Set<string>,
    tracks: Array<{
        id: string;
        kind: string;
        color: string;
        clips: Array<{ id: string; type: string; color: string }>;
    }> | null,
    trackId: string,
    clipId: string,
    view: ViewportRange,
    dragPreview: DragPreview = null
): void {
    const activeTrack = tracks?.find((time) => time.id === trackId);
    const activeClip = activeTrack?.clips.find((context) => context.id === clipId);
    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';
    const selectedColor = brightenColor(clipColor, 0.22);

    for (const note of notes) {
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

        const row = pitchToRow.get(displayPitch) ?? -1;
        if (row === -1) {
            continue;
        }
        // Cull against the drawn slice, not the clip: a long clip's notes are
        // mostly off-viewport at any useful zoom, and the whole note list is
        // walked on every repaint — including every frame of a scroll.
        if (!isSpanVisible(displayStartBeat, displayDuration, beatWidth, view)) {
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

        const velH = Math.max(1, (note.velocity / 127) * (ROW_HEIGHT - 4));
        ctx.fillStyle = colorWithAlpha(noteColor, isSelected ? 0.3 : 0.25);
        ctx.fillRect(x + 2, y + ROW_HEIGHT - 2 - velH, Math.max(2, w - 4), velH);

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(x + 1, y + 1, 4, ROW_HEIGHT - 2);
        ctx.fillRect(x + w - 5, y + 1, 4, ROW_HEIGHT - 2);

        if (w > 20) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '9px system-ui';
            ctx.fillText(`${NOTE_NAMES[displayPitch % 12]}${Math.floor(displayPitch / 12) - 1}`, x + 6, y + 11);
        }
    }
}

function drawStepCursor(
    ctx: CanvasRenderingContext2D,
    pitchToRow: Map<number, number>,
    stepBeat: number,
    stepPitch: number,
    beatWidth: number,
    gridSnap: number,
    view: ViewportRange,
    noteAreaHeight: number
): void {
    const sx = stepBeat * beatWidth;
    const row = pitchToRow.get(stepPitch) ?? -1;

    // Row highlight, across the drawn slice rather than the whole arrangement.
    if (row !== -1) {
        const sy = row * ROW_HEIGHT;
        ctx.fillStyle = 'rgba(160, 90, 120, 0.15)';
        ctx.fillRect(view.leftPx, sy, view.rightPx - view.leftPx, ROW_HEIGHT);
    }

    // Column highlight
    ctx.strokeStyle = 'rgba(160, 90, 120, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, noteAreaHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    ctx.fillStyle = 'rgba(160, 90, 120, 0.08)';
    const stepW = gridSnap * beatWidth;
    ctx.fillRect(sx, 0, stepW, noteAreaHeight);
}

function drawPreview(
    ctx: CanvasRenderingContext2D,
    pitchToRow: Map<number, number>,
    beatWidth: number,
    preview: { beat: number; pitch: number; duration: number } | null
): void {
    if (!preview) {
        return;
    }
    const dpRow = pitchToRow.get(preview.pitch) ?? -1;
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
