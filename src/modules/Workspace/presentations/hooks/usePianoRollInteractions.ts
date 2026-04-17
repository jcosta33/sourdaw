/**
 * usePianoRollInteractions — Manages all pointer/keyboard gesture logic for
 * the PianoRoll editor: mouse-down/move/up, double-click, wheel (zoom/scroll),
 * keyboard nudging, delete, step-input velocity, context menu, rubber-band
 * selection, lasso, and paint-mode draws.
 *
 * Extracted from PianoRoll.tsx to keep the view file focused on layout + rendering.
 */
import {
    type MouseEvent,
    type WheelEvent,
    type KeyboardEvent,
    type Dispatch,
    type SetStateAction,
    useRef,
    useEffect,
    useState,
} from 'react';

import { pushUndoEntry } from '#/modules/Command/useCases';
import {
    addMidiNote,
    batchAddMidiNotes,
    getNotesForClip,
    removeMidiNote,
    moveMidiNote,
    removeNotesByIds,
    resizeMidiNote,
    setNoteVelocity,
    setNotesForClip,
    stampChord,
    joinNotes,
    legatoNotes,
    splitNoteAtBeat,
} from '#/modules/MIDI/useCases';
import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { playAuditionNote } from '#/modules/AudioEngine/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

import {
    ROW_HEIGHT,
    RULER_HEIGHT,
    SCALES,
    type DragState,
    type PianoRollMenu,
    INITIAL_DRAG_STATE,
    getVisiblePitches,
} from '../helpers/pianoRollConstants';

import { type GestureEvent } from '#/utils/DOM/GestureEvent';

/**
 * Build ownership maps from primary + secondary clip notes.
 * Returns noteToClip (noteId → clipId) and allNotesMap (noteId → MidiNote).
 */
function buildNoteOwnershipMaps(
    notes: MidiNote[],
    clipId: string,
    openedClipNotes: Record<string, MidiNote[]> | undefined
): { noteToClip: Map<string, string>; allNotesMap: Map<string, MidiNote> } {
    const noteToClip = new Map<string, string>();
    const allNotesMap = new Map<string, MidiNote>();
    for (const n of notes) { allNotesMap.set(n.id, n); noteToClip.set(n.id, clipId); }
    if (openedClipNotes) {
        for (const [oid, ns] of Object.entries(openedClipNotes)) {
            for (const n of ns) { allNotesMap.set(n.id, n); noteToClip.set(n.id, oid); }
        }
    }
    return { noteToClip, allNotesMap };
}

type PianoRollChordType =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

type InteractionArgs = {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    clipId: string;
    trackId: string;
    notes: MidiNote[];
    /** A9: notes from all simultaneously-open clips, keyed by clip ID */
    openedClipNotes?: Record<string, MidiNote[]>;
    /** A9: which clip receives newly drawn notes */
    focusedClipId?: string;
    beatWidth: number;
    gridSnap: number;
    scaleType: string;
    scaleRoot: number;
    isFolded: boolean;
    stepInput: boolean;
    stepBeat: number;
    setStepBeat: Dispatch<SetStateAction<number>>;
    chordMode: boolean;
    chordType: PianoRollChordType;
    paintMode: boolean;
    lassoMode: boolean;
    selectedNoteIds: Set<string>;
    setSelectedNoteIds: Dispatch<SetStateAction<Set<string>>>;
    setZoom: Dispatch<SetStateAction<number>>;
    setScrollX: Dispatch<SetStateAction<number>>;
    draw: () => void;
    /** R-A12: when true, note draw and move snaps pitch to nearest scale degree. */
    constrainToScale: boolean;
    /** R-A13: when true, hovering a note for 200ms plays a short audition. */
    notePreviewEnabled: boolean;
    drawPreviewRef: React.RefObject<{ beat: number; pitch: number; duration: number } | null>;
    rubberBandRef: React.RefObject<{ x: number; y: number; w: number; h: number } | null>;
    dragPreviewRef: React.RefObject<{
        noteIds: Set<string>;
        beatDelta: number;
        pitchDelta: number;
        isDuplicate?: boolean;
        durationOverride?: Map<string, number>;
        beatOverride?: Map<string, { beat: number; duration: number }>;
    } | null>;
};

type InteractionHandlers = {
    handleMouseDown: (e: MouseEvent<HTMLCanvasElement>) => void;
    handleMouseMove: (e: MouseEvent<HTMLCanvasElement>) => void;
    handleMouseUp: (e: MouseEvent<HTMLCanvasElement>) => void;
    handleDoubleClick: (e: MouseEvent<HTMLCanvasElement>) => void;
    handleWheel: (e: WheelEvent<HTMLCanvasElement>) => void;
    handleKeyDown: (e: KeyboardEvent<HTMLCanvasElement>) => void;
    handleContextMenu: (e: MouseEvent<HTMLCanvasElement>) => void;
    ctxMenu: PianoRollMenu;
    setCtxMenu: Dispatch<SetStateAction<PianoRollMenu>>;
    hoverCursor: string;
};

export function usePianoRollInteractions(args: InteractionArgs): InteractionHandlers {
    const {
        canvasRef,
        clipId,
        trackId,
        notes,
        openedClipNotes,
        focusedClipId,
        beatWidth,
        gridSnap,
        scaleType,
        scaleRoot,
        isFolded,
        stepInput,
        stepBeat,
        setStepBeat,
        chordMode,
        chordType,
        paintMode,
        lassoMode,
        selectedNoteIds,
        setSelectedNoteIds,
        setZoom,
        setScrollX,
        draw,
        constrainToScale,
        notePreviewEnabled,
        drawPreviewRef,
        rubberBandRef,
        dragPreviewRef,
    } = args;

    const dragRef = useRef<DragState>({ ...INITIAL_DRAG_STATE });
    const paintNotesRef = useRef<Set<string>>(new Set());
    const lassoPathRef = useRef<Array<{ x: number; y: number }>>([]);
    const auditionRef = useRef<(() => void) | null>(null);
    /** R-A13: debounce timer for note-hover audition. */
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** R-A13: ID of the note currently under the debounce timer. */
    const hoverNoteIdRef = useRef<string | null>(null);

    const [ctxMenu, setCtxMenu] = useState<PianoRollMenu>(null);
    const [hoverCursor, setHoverCursor] = useState<string>('crosshair');

    // ── Pinch-to-zoom (macOS gesture events) ─────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        let lastScale = 1;
        const onGestureStart = (e: Event): void => {
            e.preventDefault();
            lastScale = 1;
        };
        const onGestureChange = (e: Event): void => {
            e.preventDefault();
            const ge = e as GestureEvent;
            const delta = ge.scale - lastScale;
            lastScale = ge.scale;
            setZoom((prev) => Math.max(0.25, Math.min(4, prev + delta * 0.5)));
        };
        const onGestureEnd = (e: Event): void => {
            e.preventDefault();
        };
        canvas.addEventListener('gesturestart', onGestureStart, { passive: false });
        canvas.addEventListener('gesturechange', onGestureChange, { passive: false });
        canvas.addEventListener('gestureend', onGestureEnd, { passive: false });
        return () => {
            canvas.removeEventListener('gesturestart', onGestureStart);
            canvas.removeEventListener('gesturechange', onGestureChange);
            canvas.removeEventListener('gestureend', onGestureEnd);
        };
    }, [canvasRef, setZoom]);

    // ── Helpers ───────────────────────────────────────────────────────
    const snap = (value: number): number => {
        if (gridSnap <= 0) {
            return value;
        }
        return Math.round(value / gridSnap) * gridSnap;
    };

    /**
     * R-A12: Snap a MIDI pitch to the nearest scale degree when constrainToScale is active.
     * When constrainToScale is false (or scale is chromatic), returns the pitch unchanged.
     */
    const snapToScalePitch = (rawPitch: number): number => {
        if (!constrainToScale || scaleType === 'chromatic') {
            return rawPitch;
        }
        const intervals = SCALES[scaleType] ?? SCALES['chromatic']!;
        const noteInOctave = rawPitch % 12;
        const relative = ((noteInOctave - scaleRoot) + 12) % 12;
        let bestInterval = intervals[0]!;
        let minDist = 12;
        for (const interval of intervals) {
            const dist = Math.min(Math.abs(relative - interval), 12 - Math.abs(relative - interval));
            if (dist < minDist) {
                minDist = dist;
                bestInterval = interval;
            }
        }
        const octave = Math.floor(rawPitch / 12);
        let snapped = octave * 12 + ((bestInterval + scaleRoot) % 12);
        // Avoid shifting to a different octave for extreme pitches
        if (snapped - rawPitch > 6) snapped -= 12;
        if (rawPitch - snapped > 6) snapped += 12;
        return Math.max(0, Math.min(127, snapped));
    };

    const hitTest = (x: number, y: number): { note: MidiNote; edge: 'body' | 'left' | 'right'; ownerClipId: string } | null => {
        const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
        // O(1) pitch→row lookup instead of indexOf per note
        const pitchToRow = new Map<number, number>();
        for (let i = 0; i < visiblePitches.length; i++) {
            pitchToRow.set(visiblePitches[i]!, i);
        }

        const testNoteList = (noteList: MidiNote[], ownerClipId: string) => {
            for (let i = noteList.length - 1; i >= 0; i--) {
                const note = noteList[i]!;
                const row = pitchToRow.get(note.pitch) ?? -1;
                if (row === -1) continue;
                const nx = note.startBeat * beatWidth;
                const ny = row * ROW_HEIGHT;
                const nw = note.duration * beatWidth;
                if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
                    if (x <= nx + 8) return { note, edge: 'left' as const, ownerClipId };
                    if (x >= nx + nw - 8) return { note, edge: 'right' as const, ownerClipId };
                    return { note, edge: 'body' as const, ownerClipId };
                }
            }
            return null;
        };

        // Check primary clip first (higher z-order)
        const primaryHit = testNoteList(notes, clipId);
        if (primaryHit) return primaryHit;

        // A9: also check notes from secondary open clips
        if (openedClipNotes) {
            for (const [openedId, openedNotes] of Object.entries(openedClipNotes)) {
                if (openedId === clipId) continue;
                const hit = testNoteList(openedNotes, openedId);
                if (hit) return hit;
            }
        }

        return null;
    };

    // ── Mouse handlers ───────────────────────────────────────────────
    const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>): void => {
        // R-A13: cancel hover preview timer on mousedown
        if (hoverTimerRef.current !== null) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        hoverNoteIdRef.current = null;

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        if (rawY < RULER_HEIGHT) {
            return;
        }
        const noteY = rawY - RULER_HEIGHT;
        const hit = hitTest(x, noteY);

        if (hit) {
            if (e.shiftKey) {
                setSelectedNoteIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(hit.note.id)) {
                        next.delete(hit.note.id);
                    } else {
                        next.add(hit.note.id);
                    }
                    return next;
                });
                return;
            }
            if (!selectedNoteIds.has(hit.note.id)) {
                setSelectedNoteIds(new Set([hit.note.id]));
            }
            if (hit.edge === 'left') {
                dragRef.current = {
                    mode: 'resize-left',
                    noteId: hit.note.id,
                    ownerClipId: hit.ownerClipId,
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
            } else if (hit.edge === 'right') {
                dragRef.current = {
                    mode: 'resize-right',
                    noteId: hit.note.id,
                    ownerClipId: hit.ownerClipId,
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
            } else {
                auditionRef.current = playAuditionNote(trackId, hit.note.pitch, hit.note.velocity);
                dragRef.current = {
                    mode: e.altKey ? 'duplicate' : 'move',
                    noteId: hit.note.id,
                    ownerClipId: hit.ownerClipId,
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
            }
        } else {
            if (e.altKey) {
                if (!e.shiftKey) {
                    setSelectedNoteIds(new Set());
                }
                rubberBandRef.current = { x, y: noteY, w: 0, h: 0 };
                dragRef.current = {
                    mode: 'rubber-band',
                    noteId: null,
                    startX: x,
                    startY: noteY,
                    origBeat: 0,
                    origPitch: 0,
                    origDuration: 0,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
                return;
            } else if (lassoMode) {
                lassoPathRef.current = [{ x, y: noteY }];
                setSelectedNoteIds(new Set());
                dragRef.current = {
                    mode: 'lasso',
                    noteId: null,
                    startX: x,
                    startY: noteY,
                    origBeat: 0,
                    origPitch: 0,
                    origDuration: 0,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
                return;
            }

            const row = Math.floor(noteY / ROW_HEIGHT);
            const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
            if (row >= 0 && row < visiblePitches.length) {
                // R-A12: snap to nearest scale degree when constrainToScale is active
                const pitch = snapToScalePitch(visiblePitches[row]!);
                if (pitch >= 0 && pitch < 128) {
                    if (stepInput) {
                        const note = addMidiNote(clipId, pitch, stepBeat, gridSnap, 100);
                        pushUndoEntry(
                            'Add MIDI note',
                            () => removeMidiNote(clipId, note.id),
                            () => addMidiNote(clipId, pitch, stepBeat, gridSnap, 100)
                        );
                        setStepBeat((prev) => prev + gridSnap);
                        setSelectedNoteIds(new Set());
                    } else if (chordMode) {
                        const beat = snap(x / beatWidth);
                        const created = stampChord(clipId, pitch, beat, gridSnap, 100, chordType);
                        if (created.length > 0) {
                            const createdIds = created.map((n) => n.id);
                            pushUndoEntry(
                                `Stamp ${chordType} chord`,
                                () => removeNotesByIds(clipId, createdIds),
                                () => stampChord(clipId, pitch, beat, gridSnap, 100, chordType)
                            );
                            setSelectedNoteIds(new Set(createdIds));
                        }
                    } else if (paintMode) {
                        const beat = snap(x / beatWidth);
                        const note = addMidiNote(clipId, pitch, beat, gridSnap, 100);
                        paintNotesRef.current = new Set([note.id]);
                        dragRef.current = {
                            mode: 'paint',
                            noteId: null,
                            startX: x,
                            startY: noteY,
                            origBeat: beat,
                            origPitch: pitch,
                            origDuration: gridSnap,
                            _prevDeltaBeat: 0,
                            _prevDeltaPitch: 0,
                        };
                        setSelectedNoteIds(new Set());
                    } else {
                        auditionRef.current = playAuditionNote(trackId, pitch, 100);
                        const beat = snap(x / beatWidth);
                        drawPreviewRef.current = { beat, pitch, duration: gridSnap };
                        dragRef.current = {
                            mode: 'draw',
                            noteId: null,
                            startX: x,
                            startY: noteY,
                            origBeat: beat,
                            origPitch: pitch,
                            origDuration: gridSnap,
                            _prevDeltaBeat: 0,
                            _prevDeltaPitch: 0,
                        };
                        setSelectedNoteIds(new Set());
                        draw();
                    }
                }
            }
        }
    };

    const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>): void => {
        const drag = dragRef.current;
        if (drag.mode === 'none') {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const hx = e.clientX - rect.left;
            const hy = e.clientY - rect.top - RULER_HEIGHT;
            if (hy >= 0) {
                const hit = hitTest(hx, hy);
                setHoverCursor(hit ? (hit.edge === 'body' ? 'grab' : 'ew-resize') : 'crosshair');

                // R-A13: note preview on hover — debounce 200ms, fire playAuditionNote
                if (notePreviewEnabled && hit?.edge === 'body') {
                    if (hoverNoteIdRef.current !== hit.note.id) {
                        // Moved to a different note — clear existing timer and start fresh
                        if (hoverTimerRef.current !== null) {
                            clearTimeout(hoverTimerRef.current);
                        }
                        hoverNoteIdRef.current = hit.note.id;
                        hoverTimerRef.current = setTimeout(() => {
                            hoverTimerRef.current = null;
                            const stopFn = playAuditionNote(trackId, hit.note.pitch, hit.note.velocity);
                            // Auto-stop after 500ms to keep audition brief
                            setTimeout(() => stopFn(), 500);
                        }, 200);
                    }
                } else {
                    // No note under cursor — clear timer
                    if (hoverTimerRef.current !== null) {
                        clearTimeout(hoverTimerRef.current);
                        hoverTimerRef.current = null;
                    }
                    hoverNoteIdRef.current = null;
                }
            } else {
                setHoverCursor('crosshair');
                if (hoverTimerRef.current !== null) {
                    clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = null;
                }
                hoverNoteIdRef.current = null;
            }
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const noteY = e.clientY - rect.top - RULER_HEIGHT;

        if (drag.mode === 'rubber-band') {
            rubberBandRef.current = {
                x: Math.min(drag.startX, x),
                y: Math.min(drag.startY, noteY),
                w: Math.abs(x - drag.startX),
                h: Math.abs(noteY - drag.startY),
            };
            draw();
            return;
        }

        if (drag.mode === 'lasso') {
            lassoPathRef.current.push({ x, y: noteY });
            draw();
            const canvasEl = canvasRef.current;
            if (canvasEl) {
                const ctx = canvasEl.getContext('2d');
                if (ctx && lassoPathRef.current.length > 1) {
                    ctx.strokeStyle = 'rgba(128, 104, 152, 0.8)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath();
                    const p0 = lassoPathRef.current[0]!;
                    ctx.moveTo(p0.x, p0.y + RULER_HEIGHT);
                    for (let i = 1; i < lassoPathRef.current.length; i++) {
                        const pt = lassoPathRef.current[i]!;
                        ctx.lineTo(pt.x, pt.y + RULER_HEIGHT);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
            return;
        }

        if (drag.mode === 'paint') {
            const currentBeat = snap(x / beatWidth);
            const lowBeat = Math.min(drag.origBeat, currentBeat);
            const highBeat = Math.max(drag.origBeat, currentBeat);
            for (let b = lowBeat; b <= highBeat; b += gridSnap) {
                const snappedB = snap(b);
                const exists = notes.some(
                    (n) => Math.abs(n.startBeat - snappedB) < 0.001 && n.pitch === drag.origPitch
                );
                if (!exists) {
                    const note = addMidiNote(clipId, drag.origPitch, snappedB, gridSnap, 100);
                    paintNotesRef.current.add(note.id);
                }
            }
            return;
        }

        if (!drag.noteId && drag.mode !== 'draw') {
            return;
        }

        if (drag.mode === 'draw') {
            const currentBeat = snap(x / beatWidth);
            drawPreviewRef.current = {
                beat: drag.origBeat,
                pitch: drag.origPitch,
                duration: Math.max(gridSnap, currentBeat - drag.origBeat),
            };
            draw();
        } else if (drag.mode === 'move' || drag.mode === 'duplicate') {
            const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const deltaRow = Math.round((noteY - drag.startY) / ROW_HEIGHT);
            const anchorOrigRow = visiblePitches.indexOf(drag.origPitch);
            let targetPitch = drag.origPitch;
            if (anchorOrigRow !== -1) {
                const anchorNewRow = Math.max(0, Math.min(visiblePitches.length - 1, anchorOrigRow + deltaRow));
                targetPitch = visiblePitches[anchorNewRow]!;
            }
            const deltaPitch = targetPitch - drag.origPitch;
            const idsToMove =
                selectedNoteIds.size > 0 && selectedNoteIds.has(drag.noteId!)
                    ? selectedNoteIds
                    : new Set([drag.noteId!]);
            // Update ephemeral drag preview ref and redraw canvas directly —
            // no midiStore mutation during drag (eliminates 60Hz CRDT writes + React re-renders)
            dragPreviewRef.current = {
                noteIds: idsToMove,
                beatDelta: deltaBeat,
                pitchDelta: deltaPitch,
                isDuplicate: drag.mode === 'duplicate',
            };
            dragRef.current._prevDeltaBeat = deltaBeat;
            dragRef.current._prevDeltaPitch = deltaPitch;
            draw();
        } else if (drag.mode === 'resize-left') {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const endBeat = drag.origBeat + drag.origDuration;
            const clampedBeat = Math.min(Math.max(0, drag.origBeat + deltaBeat), endBeat - gridSnap);
            const beatOverride = new Map([[drag.noteId!, { beat: clampedBeat, duration: endBeat - clampedBeat }]]);
            dragPreviewRef.current = { noteIds: new Set([drag.noteId!]), beatDelta: 0, pitchDelta: 0, beatOverride };
            draw();
        } else if (drag.mode === 'resize-right') {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const newDuration = Math.max(gridSnap, drag.origDuration + deltaBeat);
            const durationOverride = new Map([[drag.noteId!, newDuration]]);
            dragPreviewRef.current = {
                noteIds: new Set([drag.noteId!]),
                beatDelta: 0,
                pitchDelta: 0,
                durationOverride,
            };
            draw();
        }
    };

    const handleMouseUp = (e: MouseEvent<HTMLCanvasElement>): void => {
        if (auditionRef.current) {
            auditionRef.current();
            auditionRef.current = null;
        }
        const drag = dragRef.current;

        if (drag.mode === 'rubber-band') {
            const rb = rubberBandRef.current;
            if (rb && (rb.w > 2 || rb.h > 2)) {
                const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
                const hitIds = new Set<string>();
                const testRubberBand = (noteList: MidiNote[]): void => {
                    for (const note of noteList) {
                        const row = visiblePitches.indexOf(note.pitch);
                        if (row === -1) {
                            continue;
                        }
                        const nx = note.startBeat * beatWidth;
                        const ny = row * ROW_HEIGHT;
                        const nw = note.duration * beatWidth;
                        if (nx + nw > rb.x && nx < rb.x + rb.w && ny + ROW_HEIGHT > rb.y && ny < rb.y + rb.h) {
                            hitIds.add(note.id);
                        }
                    }
                };
                testRubberBand(notes);
                if (openedClipNotes) {
                    for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                        if (oid === clipId) continue;
                        testRubberBand(openedNotes);
                    }
                }
                setSelectedNoteIds(e.shiftKey ? (prev) => new Set([...prev, ...hitIds]) : hitIds);
            }
            rubberBandRef.current = null;
            dragRef.current = { ...INITIAL_DRAG_STATE };
            draw();
            return;
        }

        if (drag.mode === 'draw') {
            const dp = drawPreviewRef.current;
            if (dp) {
                // A9: new notes go to focusedClipId (or primary clipId if not set)
                const targetClipId = focusedClipId ?? clipId;
                const note = addMidiNote(targetClipId, dp.pitch, dp.beat, dp.duration, 100);
                pushUndoEntry(
                    'Draw MIDI note',
                    () => removeMidiNote(targetClipId, note.id),
                    () => addMidiNote(targetClipId, dp.pitch, dp.beat, dp.duration, 100)
                );
            }
            drawPreviewRef.current = null;
            draw();
        } else if (drag.mode !== 'none' && drag.noteId) {
            // A9: use the clip that owns the dragged note (may be different from primary clipId)
            const noteClipId = drag.ownerClipId ?? clipId;
            const { noteId, origBeat, origDuration, mode } = drag;
            const preview = dragPreviewRef.current;

            if (mode === 'duplicate' && preview && (preview.beatDelta !== 0 || preview.pitchDelta !== 0)) {
                // Alt+drag duplicate: originals stay, copies land at final positions (R-A1)
                const dupIds = [...preview.noteIds];
                // A9: map each note to its owning clip
                const { noteToClip, allNotesMap } = buildNoteOwnershipMaps(notes, clipId, openedClipNotes);
                // Group source notes by their owning clip
                const byClip = new Map<string, MidiNote[]>();
                for (const id of dupIds) {
                    const n = allNotesMap.get(id);
                    if (!n) continue;
                    const cid = noteToClip.get(id) ?? noteClipId;
                    const arr = byClip.get(cid) ?? [];
                    arr.push(n);
                    byClip.set(cid, arr);
                }
                const allCopyIds: string[] = [];
                const copyByClip: Array<{ clipId: string; ids: string[] }> = [];
                for (const [cid, srcNotes] of byClip) {
                    const copies = batchAddMidiNotes(
                        cid,
                        srcNotes.map((n) => ({
                            pitch: Math.max(0, Math.min(127, n.pitch + preview.pitchDelta)),
                            startBeat: Math.max(0, n.startBeat + preview.beatDelta),
                            duration: n.duration,
                            velocity: n.velocity,
                        }))
                    );
                    const ids = copies.map((c) => c.id);
                    allCopyIds.push(...ids);
                    copyByClip.push({ clipId: cid, ids });
                }
                pushUndoEntry(
                    `Duplicate ${dupIds.length} note${dupIds.length > 1 ? 's' : ''}`,
                    () => { for (const entry of copyByClip) removeNotesByIds(entry.clipId, entry.ids); },
                    () => {
                        for (const [cid, srcNotes] of byClip) {
                            batchAddMidiNotes(
                                cid,
                                srcNotes.map((n) => ({
                                    pitch: Math.max(0, Math.min(127, n.pitch + preview.pitchDelta)),
                                    startBeat: Math.max(0, n.startBeat + preview.beatDelta),
                                    duration: n.duration,
                                    velocity: n.velocity,
                                }))
                            );
                        }
                    }
                );
                setSelectedNoteIds(new Set(allCopyIds));
            } else if (mode === 'move' && preview && (preview.beatDelta !== 0 || preview.pitchDelta !== 0)) {
                const movedIds = [...preview.noteIds];
                // A9: map each note to its owning clip for multi-clip moves
                const { noteToClip: noteToClip2, allNotesMap: allNotesMap2 } = buildNoteOwnershipMaps(notes, clipId, openedClipNotes);
                const origPositions = movedIds.map((id) => {
                    const n = allNotesMap2.get(id);
                    return { id, clipId: noteToClip2.get(id) ?? noteClipId, beat: n?.startBeat ?? 0, pitch: n?.pitch ?? 0 };
                });
                const newPositions = origPositions.map((p) => ({
                    id: p.id,
                    clipId: p.clipId,
                    beat: Math.max(0, p.beat + preview.beatDelta),
                    // R-A12: snap final pitch to scale when constrain is active
                    pitch: snapToScalePitch(Math.max(0, Math.min(127, p.pitch + preview.pitchDelta))),
                }));
                for (const p of newPositions) {
                    moveMidiNote(p.clipId, p.id, p.pitch, p.beat);
                }
                pushUndoEntry(
                    `Move ${movedIds.length} note${movedIds.length > 1 ? 's' : ''}`,
                    () => {
                        for (const p of origPositions) {
                            moveMidiNote(p.clipId, p.id, p.pitch, p.beat);
                        }
                    },
                    () => {
                        for (const p of newPositions) {
                            moveMidiNote(p.clipId, p.id, p.pitch, p.beat);
                        }
                    }
                );
            } else if (mode === 'resize-left' && preview?.beatOverride?.has(noteId)) {
                const override = preview.beatOverride.get(noteId)!;
                const note = notes.find((n) => n.id === noteId) ?? openedClipNotes?.[noteClipId]?.find((n) => n.id === noteId);
                if (note && (override.beat !== origBeat || override.duration !== origDuration)) {
                    resizeMidiNote(noteClipId, noteId, override.beat, override.duration);
                    pushUndoEntry(
                        'Resize MIDI note',
                        () => {
                            removeMidiNote(noteClipId, noteId);
                            addMidiNote(noteClipId, note.pitch, origBeat, origDuration, note.velocity);
                        },
                        () => {
                            removeMidiNote(noteClipId, noteId);
                            addMidiNote(noteClipId, note.pitch, override.beat, override.duration, note.velocity);
                        }
                    );
                }
            } else if (mode === 'resize-right' && preview?.durationOverride?.has(noteId)) {
                const newDuration = preview.durationOverride.get(noteId)!;
                const note = notes.find((n) => n.id === noteId) ?? openedClipNotes?.[noteClipId]?.find((n) => n.id === noteId);
                if (note && newDuration !== origDuration) {
                    resizeMidiNote(noteClipId, noteId, undefined, newDuration);
                    pushUndoEntry(
                        'Resize MIDI note',
                        () => {
                            removeMidiNote(noteClipId, noteId);
                            addMidiNote(noteClipId, note.pitch, origBeat, origDuration, note.velocity);
                        },
                        () => {
                            removeMidiNote(noteClipId, noteId);
                            addMidiNote(noteClipId, note.pitch, origBeat, newDuration, note.velocity);
                        }
                    );
                }
            }
        }
        dragPreviewRef.current = null;
        drawPreviewRef.current = null;

        if (drag.mode === 'lasso' && lassoPathRef.current.length > 2) {
            const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
            const path = lassoPathRef.current;
            const enclosed = new Set<string>();
            const testLasso = (noteList: MidiNote[]): void => {
                for (const note of noteList) {
                    const row = visiblePitches.indexOf(note.pitch);
                    if (row === -1) {
                        continue;
                    }
                    const cx = (note.startBeat + note.duration / 2) * beatWidth;
                    const cy = row * ROW_HEIGHT + ROW_HEIGHT / 2;
                    let inside = false;
                    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
                        const pi = path[i]!;
                        const pj = path[j]!;
                        if (pi.y > cy !== pj.y > cy && cx < ((pj.x - pi.x) * (cy - pi.y)) / (pj.y - pi.y) + pi.x) {
                            inside = !inside;
                        }
                    }
                    if (inside) {
                        enclosed.add(note.id);
                    }
                }
            };
            testLasso(notes);
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) continue;
                    testLasso(openedNotes);
                }
            }
            setSelectedNoteIds(enclosed);
            lassoPathRef.current = [];
        }

        if (drag.mode === 'paint') {
            const paintedIds = [...paintNotesRef.current];
            if (paintedIds.length > 0) {
                const paintedNotes = notes.filter((n) => paintNotesRef.current.has(n.id)).map((n) => ({ ...n }));
                pushUndoEntry(
                    `Paint ${paintedIds.length} note${paintedIds.length > 1 ? 's' : ''}`,
                    () => {
                        for (const id of paintedIds) {
                            removeMidiNote(clipId, id);
                        }
                    },
                    () => {
                        for (const n of paintedNotes) {
                            addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                        }
                    }
                );
            }
            paintNotesRef.current = new Set();
        }

        dragRef.current = { ...INITIAL_DRAG_STATE };
    };

    const handleDoubleClick = (e: MouseEvent<HTMLCanvasElement>): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        if (rawY < RULER_HEIGHT) {
            return;
        }
        const hit = hitTest(x, rawY - RULER_HEIGHT);
        if (hit) {
            const { pitch, startBeat, duration, velocity } = hit.note;
            removeMidiNote(hit.ownerClipId, hit.note.id);
            pushUndoEntry(
                'Delete MIDI note',
                () => addMidiNote(hit.ownerClipId, pitch, startBeat, duration, velocity),
                () => removeMidiNote(hit.ownerClipId, hit.note.id)
            );
        }
    };

    const handleWheel = (e: WheelEvent<HTMLCanvasElement>): void => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const isPinch = Math.abs(e.deltaY) < 10;
            const sensitivity = isPinch ? 0.008 : 0.002;
            setZoom((prev) => Math.max(0.25, Math.min(4, prev - e.deltaY * sensitivity)));
        } else {
            setScrollX((prev) => Math.max(0, prev + e.deltaX));
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLCanvasElement>): void => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteIds.size > 0) {
            // A9: group selected notes by owning clip for multi-clip delete
            const notesWithClip: Array<{ note: MidiNote; ownerClipId: string }> = [];
            for (const n of notes) {
                if (selectedNoteIds.has(n.id)) notesWithClip.push({ note: { ...n }, ownerClipId: clipId });
            }
            if (openedClipNotes) {
                for (const [oid, ns] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) continue;
                    for (const n of ns) {
                        if (selectedNoteIds.has(n.id)) notesWithClip.push({ note: { ...n }, ownerClipId: oid });
                    }
                }
            }
            for (const { note, ownerClipId: oid } of notesWithClip) {
                removeMidiNote(oid, note.id);
            }
            if (notesWithClip.length > 0) {
                pushUndoEntry(
                    `Delete ${notesWithClip.length} note${notesWithClip.length > 1 ? 's' : ''}`,
                    () => {
                        for (const { note: n, ownerClipId: oid } of notesWithClip) {
                            addMidiNote(oid, n.pitch, n.startBeat, n.duration, n.velocity);
                        }
                    },
                    () => {
                        for (const { note: n, ownerClipId: oid } of notesWithClip) {
                            removeMidiNote(oid, n.id);
                        }
                    }
                );
            }
            setSelectedNoteIds(new Set());
        }
        if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            const allIds = new Set(notes.map((n) => n.id));
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) continue;
                    for (const n of openedNotes) allIds.add(n.id);
                }
            }
            setSelectedNoteIds(allIds);
        }

        // ── A2: Ctrl/Cmd+D — Duplicate selection forward ───────────────────
        if (e.key === 'd' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
            e.preventDefault();
            // Prevent global arrangement.duplicateClip shortcut from also firing
            e.nativeEvent.stopImmediatePropagation();
            // A9: build targets from both primary and opened clips
            const targetsWithClip: Array<{ note: MidiNote; ownerClipId: string }> = [];
            if (selectedNoteIds.size > 0) {
                for (const n of notes) {
                    if (selectedNoteIds.has(n.id)) targetsWithClip.push({ note: n, ownerClipId: clipId });
                }
                if (openedClipNotes) {
                    for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                        if (oid === clipId) continue;
                        for (const n of openedNotes) {
                            if (selectedNoteIds.has(n.id)) targetsWithClip.push({ note: n, ownerClipId: oid });
                        }
                    }
                }
            } else {
                for (const n of notes) targetsWithClip.push({ note: n, ownerClipId: clipId });
            }
            if (targetsWithClip.length > 0) {
                const allTargetNotes = targetsWithClip.map((t) => t.note);
                const selStart = Math.min(...allTargetNotes.map((n) => n.startBeat));
                const selEnd = Math.max(...allTargetNotes.map((n) => n.startBeat + n.duration));
                const span = selEnd - selStart;
                // Group by clip
                const byClip = new Map<string, MidiNote[]>();
                for (const { note, ownerClipId: oid } of targetsWithClip) {
                    const arr = byClip.get(oid) ?? [];
                    arr.push(note);
                    byClip.set(oid, arr);
                }
                const allCopyIds: string[] = [];
                const copyByClip: Array<{ clipId: string; ids: string[] }> = [];
                for (const [cid, clipNotes] of byClip) {
                    const copies = batchAddMidiNotes(
                        cid,
                        clipNotes.map((n) => ({
                            pitch: n.pitch,
                            startBeat: n.startBeat + span,
                            duration: n.duration,
                            velocity: n.velocity,
                        }))
                    );
                    const ids = copies.map((c) => c.id);
                    allCopyIds.push(...ids);
                    copyByClip.push({ clipId: cid, ids });
                }
                pushUndoEntry(
                    `Duplicate ${targetsWithClip.length} note${targetsWithClip.length > 1 ? 's' : ''} forward`,
                    () => { for (const entry of copyByClip) removeNotesByIds(entry.clipId, entry.ids); },
                    () => {
                        for (const [cid, clipNotes] of byClip) {
                            batchAddMidiNotes(
                                cid,
                                clipNotes.map((n) => ({
                                    pitch: n.pitch,
                                    startBeat: n.startBeat + span,
                                    duration: n.duration,
                                    velocity: n.velocity,
                                }))
                            );
                        }
                    }
                );
                setSelectedNoteIds(new Set(allCopyIds));
            }
        }

        // A9: helper — determine the single owning clip for all selected notes, or null if they span multiple clips
        const getSingleClipForSelection = (): string | null => {
            const primaryHasSelected = notes.some((n) => selectedNoteIds.has(n.id));
            let ownerClip: string | null = primaryHasSelected ? clipId : null;
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) continue;
                    const hasSelected = openedNotes.some((n) => selectedNoteIds.has(n.id));
                    if (hasSelected) {
                        if (ownerClip !== null && ownerClip !== oid) return null; // spans multiple clips
                        ownerClip = oid;
                    }
                }
            }
            return ownerClip;
        };

        // ── A4: L — Legato ─────────────────────────────────────────────────
        if (e.key === 'l' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !stepInput && selectedNoteIds.size > 0) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                e.preventDefault();
                const ids = [...selectedNoteIds];
                const clipNotesArr = singleClip === clipId ? notes : (openedClipNotes?.[singleClip] ?? []);
                const beforeDurations = clipNotesArr
                    .filter((n) => ids.includes(n.id))
                    .map((n) => ({ id: n.id, duration: n.duration }));
                legatoNotes(singleClip, ids);
                const postNotes = getNotesForClip(singleClip);
                const afterDurations = postNotes
                    .filter((n) => ids.includes(n.id))
                    .map((n) => ({ id: n.id, duration: n.duration }));
                pushUndoEntry(
                    'Legato notes',
                    () => {
                        for (const b of beforeDurations) {
                            resizeMidiNote(singleClip, b.id, undefined, b.duration);
                        }
                    },
                    () => {
                        for (const a of afterDurations) {
                            resizeMidiNote(singleClip, a.id, undefined, a.duration);
                        }
                    }
                );
            }
        }

        // ── A5: Shift+S — Split at cursor ──────────────────────────────────
        if (e.key === 'S' && e.shiftKey && !e.metaKey && !e.ctrlKey && selectedNoteIds.size > 0) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                e.preventDefault();
                e.stopPropagation();
                const playheadBeat = getTransportState()?.playheadPosition ?? 0;
                const ids = [...selectedNoteIds];
                const snapshotBefore = getNotesForClip(singleClip).map((n) => ({ ...n }));
                splitNoteAtBeat(singleClip, ids, playheadBeat);
                const snapshotAfter = getNotesForClip(singleClip).map((n) => ({ ...n }));
                pushUndoEntry(
                    'Split notes at cursor',
                    () => setNotesForClip(singleClip, snapshotBefore),
                    () => setNotesForClip(singleClip, snapshotAfter)
                );
                setSelectedNoteIds(new Set());
            }
        }

        // ── A6: J — Join adjacent same-pitch notes ─────────────────────────
        if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !stepInput && selectedNoteIds.size >= 2) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                e.preventDefault();
                const ids = [...selectedNoteIds];
                const snapshotBefore = getNotesForClip(singleClip).map((n) => ({ ...n }));
                joinNotes(singleClip, ids);
                const snapshotAfter = getNotesForClip(singleClip).map((n) => ({ ...n }));
                pushUndoEntry(
                    'Join notes',
                    () => setNotesForClip(singleClip, snapshotBefore),
                    () => setNotesForClip(singleClip, snapshotAfter)
                );
                setSelectedNoteIds(new Set());
            }
        }

        if (!stepInput && selectedNoteIds.size > 0) {
            // A9: build selected notes from both primary and opened clips, tracking owning clip
            const selectedWithClip: Array<{ note: MidiNote; ownerClipId: string }> = [];
            for (const n of notes) {
                if (selectedNoteIds.has(n.id)) selectedWithClip.push({ note: n, ownerClipId: clipId });
            }
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) continue;
                    for (const n of openedNotes) {
                        if (selectedNoteIds.has(n.id)) selectedWithClip.push({ note: n, ownerClipId: oid });
                    }
                }
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const delta = e.key === 'ArrowRight' ? gridSnap : -gridSnap;
                const before = selectedWithClip.map(({ note: n, ownerClipId: oid }) => ({ id: n.id, clipId: oid, beat: n.startBeat, pitch: n.pitch }));
                for (const { note: n, ownerClipId: oid } of selectedWithClip) {
                    moveMidiNote(oid, n.id, n.pitch, Math.max(0, n.startBeat + delta));
                }
                const after = selectedWithClip.map(({ note: n, ownerClipId: oid }) => ({ id: n.id, clipId: oid, beat: Math.max(0, n.startBeat + delta), pitch: n.pitch }));
                pushUndoEntry(
                    `Nudge ${selectedWithClip.length} note${selectedWithClip.length > 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            moveMidiNote(b.clipId, b.id, b.pitch, b.beat);
                        }
                    },
                    () => {
                        for (const a of after) {
                            moveMidiNote(a.clipId, a.id, a.pitch, a.beat);
                        }
                    }
                );
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const semis = e.shiftKey ? 12 : 1;
                const delta = e.key === 'ArrowUp' ? semis : -semis;
                const before = selectedWithClip.map(({ note: n, ownerClipId: oid }) => ({ id: n.id, clipId: oid, pitch: n.pitch, beat: n.startBeat }));
                const after = selectedWithClip.map(({ note: n, ownerClipId: oid }) => ({ id: n.id, clipId: oid, pitch: Math.max(0, Math.min(127, n.pitch + delta)), beat: n.startBeat }));
                for (const { note: n, ownerClipId: oid } of selectedWithClip) {
                    moveMidiNote(oid, n.id, Math.max(0, Math.min(127, n.pitch + delta)), n.startBeat);
                }
                pushUndoEntry(
                    `Transpose ${delta > 0 ? '+' : ''}${delta} semitone${Math.abs(delta) !== 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            moveMidiNote(b.clipId, b.id, b.pitch, b.beat);
                        }
                    },
                    () => {
                        for (const a of after) {
                            moveMidiNote(a.clipId, a.id, a.pitch, a.beat);
                        }
                    }
                );
            }
        }

        if (stepInput) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                setStepBeat((prev) => prev + gridSnap);
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setStepBeat((prev) => Math.max(0, prev - gridSnap));
            }
            const velocityPresets: Record<string, number> = {
                '1': 18,
                '2': 36,
                '3': 54,
                '4': 72,
                '5': 90,
                '6': 108,
                '7': 127,
            };
            const preset = velocityPresets[e.key];
            if (preset !== undefined) {
                const origVelocities = notes
                    .filter((n) => selectedNoteIds.has(n.id))
                    .map((n) => ({ id: n.id, velocity: n.velocity }));
                for (const id of selectedNoteIds) {
                    setNoteVelocity(clipId, id, preset);
                }
                if (origVelocities.length > 0) {
                    pushUndoEntry(
                        'Set velocity',
                        () => {
                            for (const o of origVelocities) {
                                setNoteVelocity(clipId, o.id, o.velocity);
                            }
                        },
                        () => {
                            for (const o of origVelocities) {
                                setNoteVelocity(clipId, o.id, preset);
                            }
                        }
                    );
                }
            }
        }
    };

    const handleContextMenu = (e: MouseEvent<HTMLCanvasElement>): void => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        setCtxMenu({ x: e.clientX, y: e.clientY, beat: (e.clientX - rect.left) / beatWidth });
    };

    return {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleDoubleClick,
        handleWheel,
        handleKeyDown,
        handleContextMenu,
        ctxMenu,
        setCtxMenu,
        hoverCursor,
    };
}
