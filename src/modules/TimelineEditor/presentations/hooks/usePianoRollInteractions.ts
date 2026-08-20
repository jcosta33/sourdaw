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
    type KeyboardEvent,
    type Dispatch,
    type SetStateAction,
    useRef,
    useEffect,
    useState,
} from 'react';

import { trackStore } from '#/modules/Arrangement/stores';
import { playAuditionNote } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { stepRecordStore } from '#/modules/MIDI/stores';
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
    stepRecordAdvance,
    stepRecordRetreat,
    stepRecordStepUp,
    stepRecordStepDown,
    stepRecordNoteOn,
    stepRecordNoteOff,
} from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { quantizeMidiNoteToScale } from '#/utils/Music/MusicalScale';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import {
    ROW_HEIGHT,
    RULER_HEIGHT,
    type DragState,
    type PianoRollMenu,
    INITIAL_DRAG_STATE,
    getVisiblePitches,
} from '../helpers/pianoRollConstants';

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
    for (const node of notes) {
        allNotesMap.set(node.id, node);
        noteToClip.set(node.id, clipId);
    }
    if (openedClipNotes) {
        for (const [oid, ns] of Object.entries(openedClipNotes)) {
            for (const node of ns) {
                allNotesMap.set(node.id, node);
                noteToClip.set(node.id, oid);
            }
        }
    }
    return { noteToClip, allNotesMap };
}

function resolveTrackIdForClip(clipId: string, defaultTrackId: string): string {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return defaultTrackId;
    }
    const track = tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    return track ? track.id : defaultTrackId;
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
    // Default drag in empty area starts a rubber-band selection (DAW
    // convention). A click without drag still stamps a note at the clicked
    // grid cell; we stash the intended pitch/beat here so the mouse-up handler
    // can commit a stamp when no meaningful drag occurred.
    const pendingStampRef = useRef<{ pitch: number; beat: number } | null>(null);

    const [ctxMenu, setCtxMenu] = useState<PianoRollMenu>(null);
    const [hoverCursor, setHoverCursor] = useState<string>('crosshair');

    // ── Wheel: ctrl/cmd zooms the editor, and carries trackpad pinch ──
    //
    // Chromium reports a trackpad pinch as a ctrl-modified `wheel` event, so
    // the modifier branch below is the pinch path. The WebKit
    // `gesturestart`/`gesturechange`/`gestureend` trio that used to sit here is
    // never dispatched by any renderer this app ships on.
    //
    // Registered imperatively and non-passively, mirroring `useTimelineGestures`
    // on the arrangement canvas. React attaches `wheel` at its root container
    // with `{ passive: true }`, so a `preventDefault()` inside a JSX `onWheel`
    // prop is inert and the browser applies its own ctrl+wheel *page* zoom on
    // top of the editor zoom.
    //
    // Only the modifier branch cancels the default. Plain and shift+wheel are
    // left to the surrounding `overflow-auto` scroll container — the browser
    // already scrolls it vertically and, with shift, horizontally, and its
    // `onScroll` is what syncs `scrollX` back into the view.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const onWheel = (event: WheelEvent): void => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const isPinch = Math.abs(event.deltaY) < 10;
                const sensitivity = isPinch ? 0.008 : 0.002;
                setZoom((prev) => Math.max(0.25, Math.min(4, prev - event.deltaY * sensitivity)));
                return;
            }
            setScrollX((prev) => Math.max(0, prev + event.deltaX));
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', onWheel);
        };
    }, [canvasRef, setZoom, setScrollX]);

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
        return quantizeMidiNoteToScale(rawPitch, scaleRoot, scaleType);
    };

    const hitTest = (
        x: number,
        y: number
    ): { note: MidiNote; edge: 'body' | 'left' | 'right'; ownerClipId: string } | null => {
        const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
        // O(1) pitch→row lookup instead of indexOf per note
        const pitchToRow = new Map<number, number>();
        for (let index = 0; index < visiblePitches.length; index++) {
            pitchToRow.set(visiblePitches[index]!, index);
        }

        const testNoteList = (noteList: MidiNote[], ownerClipId: string) => {
            for (let index = noteList.length - 1; index >= 0; index--) {
                const note = noteList[index]!;
                const row = pitchToRow.get(note.pitch) ?? -1;
                if (row === -1) {
                    continue;
                }
                const nx = note.startBeat * beatWidth;
                const ny = row * ROW_HEIGHT;
                const nw = note.duration * beatWidth;
                if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
                    if (x <= nx + 8) {
                        return { note, edge: 'left' as const, ownerClipId };
                    }
                    if (x >= nx + nw - 8) {
                        return { note, edge: 'right' as const, ownerClipId };
                    }
                    return { note, edge: 'body' as const, ownerClipId };
                }
            }
            return null;
        };

        // Hit-test in reverse paint order so the topmost visibly painted note
        // wins. The renderer draws secondary opened clips first (in
        // openedClipIds order, later clip on top) and the primary clip's notes
        // last of all, so the primary is tested first and secondary clips are
        // tested last-opened first.
        const primaryHit = testNoteList(notes, clipId);
        if (primaryHit) {
            return primaryHit;
        }

        // A9: also check notes from secondary open clips
        if (openedClipNotes) {
            const openedEntries = Object.entries(openedClipNotes);
            for (let entryIndex = openedEntries.length - 1; entryIndex >= 0; entryIndex--) {
                const [openedId, openedNotes] = openedEntries[entryIndex]!;
                if (openedId === clipId) {
                    continue;
                }
                const hit = testNoteList(openedNotes, openedId);
                if (hit) {
                    return hit;
                }
            }
        }

        return null;
    };

    // ── Mouse handlers ───────────────────────────────────────────────
    const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>): void => {
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
        const x = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        if (rawY < RULER_HEIGHT) {
            return;
        }
        const noteY = rawY - RULER_HEIGHT;
        const hit = hitTest(x, noteY);

        if (hit) {
            if (event.shiftKey) {
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
                const auditionTrackId = resolveTrackIdForClip(hit.ownerClipId, trackId);
                auditionRef.current = playAuditionNote(auditionTrackId, hit.note.pitch, hit.note.velocity);
                dragRef.current = {
                    mode: event.altKey ? 'duplicate' : 'move',
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
            if (event.altKey) {
                if (!event.shiftKey) {
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
                // Alt-drag is the explicit select-only gesture; never stamp on release.
                pendingStampRef.current = null;
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
                            const createdIds = created.map((node) => node.id);
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
                        // Default empty-area drag is a rubber-band selection. If the user
                        // clicks without dragging (mouse-up without passing the movement
                        // threshold), the stashed `pendingStampRef` tells `handleMouseUp`
                        // to stamp a note at this grid cell — single-click-creates-a-note
                        // affordance preserved.
                        auditionRef.current = playAuditionNote(trackId, pitch, 100);
                        const beat = snap(x / beatWidth);
                        pendingStampRef.current = { pitch, beat };
                        rubberBandRef.current = { x, y: noteY, w: 0, h: 0 };
                        dragRef.current = {
                            mode: 'rubber-band',
                            noteId: null,
                            startX: x,
                            startY: noteY,
                            origBeat: beat,
                            origPitch: pitch,
                            origDuration: gridSnap,
                            _prevDeltaBeat: 0,
                            _prevDeltaPitch: 0,
                        };
                    }
                }
            }
        }
    };

    const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>): void => {
        const drag = dragRef.current;
        if (drag.mode === 'none') {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const hx = event.clientX - rect.left;
            const hy = event.clientY - rect.top - RULER_HEIGHT;
            if (hy >= 0) {
                const hit = hitTest(hx, hy);
                setHoverCursor(
                    (() => {
                        if (!hit) {
                            return 'crosshair';
                        }
                        if (hit.edge === 'body') {
                            return 'grab';
                        }
                        return 'ew-resize';
                    })()
                );

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
                            const auditionTrackId = resolveTrackIdForClip(hit.ownerClipId, trackId);
                            const stopFn = playAuditionNote(auditionTrackId, hit.note.pitch, hit.note.velocity);
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
        const x = event.clientX - rect.left;
        const noteY = event.clientY - rect.top - RULER_HEIGHT;

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
                    for (let index = 1; index < lassoPathRef.current.length; index++) {
                        const pt = lassoPathRef.current[index]!;
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
                    (node) => Math.abs(node.startBeat - snappedB) < 0.001 && node.pitch === drag.origPitch
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

    const handleMouseUp = (event: MouseEvent<HTMLCanvasElement>): void => {
        if (auditionRef.current) {
            auditionRef.current();
            auditionRef.current = null;
        }
        const drag = dragRef.current;

        if (drag.mode === 'rubber-band') {
            const rb = rubberBandRef.current;
            const meaningfulDrag = rb !== null && (rb.w > 2 || rb.h > 2);
            const pendingStamp = pendingStampRef.current;

            if (meaningfulDrag) {
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
                        if (oid === clipId) {
                            continue;
                        }
                        testRubberBand(openedNotes);
                    }
                }
                setSelectedNoteIds(event.shiftKey ? (prev) => new Set([...prev, ...hitIds]) : hitIds);
            } else if (pendingStamp) {
                // Click without drag — stamp a note at the click location.
                const note = addMidiNote(clipId, pendingStamp.pitch, pendingStamp.beat, gridSnap, 100);
                pushUndoEntry(
                    'Draw MIDI note',
                    () => removeMidiNote(clipId, note.id),
                    () => addMidiNote(clipId, pendingStamp.pitch, pendingStamp.beat, gridSnap, 100)
                );
                setSelectedNoteIds(new Set());
            } else if (!event.shiftKey) {
                // Alt-drag (explicit select) with no movement clears selection, matching
                // the previous alt-branch behaviour.
                setSelectedNoteIds(new Set());
            }

            rubberBandRef.current = null;
            pendingStampRef.current = null;
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
                    const node = allNotesMap.get(id);
                    if (!node) {
                        continue;
                    }
                    const cid = noteToClip.get(id) ?? noteClipId;
                    const arr = byClip.get(cid) ?? [];
                    arr.push(node);
                    byClip.set(cid, arr);
                }
                const allCopyIds: string[] = [];
                const copyByClip: Array<{ clipId: string; ids: string[] }> = [];
                for (const [cid, srcNotes] of byClip) {
                    const copies = batchAddMidiNotes(
                        cid,
                        srcNotes.map((node) => ({
                            pitch: Math.max(0, Math.min(127, node.pitch + preview.pitchDelta)),
                            startBeat: Math.max(0, node.startBeat + preview.beatDelta),
                            duration: node.duration,
                            velocity: node.velocity,
                        }))
                    );
                    const ids = copies.map((context) => context.id);
                    allCopyIds.push(...ids);
                    copyByClip.push({ clipId: cid, ids });
                }
                pushUndoEntry(
                    `Duplicate ${dupIds.length} note${dupIds.length > 1 ? 's' : ''}`,
                    () => {
                        for (const entry of copyByClip) {
                            removeNotesByIds(entry.clipId, entry.ids);
                        }
                    },
                    () => {
                        for (const [cid, srcNotes] of byClip) {
                            batchAddMidiNotes(
                                cid,
                                srcNotes.map((node) => ({
                                    pitch: Math.max(0, Math.min(127, node.pitch + preview.pitchDelta)),
                                    startBeat: Math.max(0, node.startBeat + preview.beatDelta),
                                    duration: node.duration,
                                    velocity: node.velocity,
                                }))
                            );
                        }
                    }
                );
                setSelectedNoteIds(new Set(allCopyIds));
            } else if (mode === 'move' && preview && (preview.beatDelta !== 0 || preview.pitchDelta !== 0)) {
                const movedIds = [...preview.noteIds];
                // A9: map each note to its owning clip for multi-clip moves
                const { noteToClip: noteToClip2, allNotesMap: allNotesMap2 } = buildNoteOwnershipMaps(
                    notes,
                    clipId,
                    openedClipNotes
                );
                const origPositions = movedIds.map((id) => {
                    const node = allNotesMap2.get(id);
                    return {
                        id,
                        clipId: noteToClip2.get(id) ?? noteClipId,
                        beat: node?.startBeat ?? 0,
                        pitch: node?.pitch ?? 0,
                    };
                });
                const newPositions = origPositions.map((param) => ({
                    id: param.id,
                    clipId: param.clipId,
                    beat: Math.max(0, param.beat + preview.beatDelta),
                    // R-A12: snap final pitch to scale when constrain is active
                    pitch: snapToScalePitch(Math.max(0, Math.min(127, param.pitch + preview.pitchDelta))),
                }));
                for (const param of newPositions) {
                    moveMidiNote(param.clipId, param.id, param.pitch, param.beat);
                }
                pushUndoEntry(
                    `Move ${movedIds.length} note${movedIds.length > 1 ? 's' : ''}`,
                    () => {
                        for (const param of origPositions) {
                            moveMidiNote(param.clipId, param.id, param.pitch, param.beat);
                        }
                    },
                    () => {
                        for (const param of newPositions) {
                            moveMidiNote(param.clipId, param.id, param.pitch, param.beat);
                        }
                    }
                );
            } else if (mode === 'resize-left' && preview?.beatOverride?.has(noteId)) {
                const override = preview.beatOverride.get(noteId)!;
                const note =
                    notes.find((node) => node.id === noteId) ??
                    openedClipNotes?.[noteClipId]?.find((node) => node.id === noteId);
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
                const note =
                    notes.find((node) => node.id === noteId) ??
                    openedClipNotes?.[noteClipId]?.find((node) => node.id === noteId);
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
            // Lasso hit test against the note's bounding box (not just its
            // center — long notes with their center outside a tight lasso but
            // edges enclosed would otherwise be missed):
            //   1. Fast-reject via polygon AABB overlap.
            //   2. Select if any of the note's corners or center is inside the
            //      polygon (covers the common "polygon encloses note" case).
            //   3. Otherwise select if any polygon vertex falls inside the note
            //      rect (covers "small lasso drawn on top of a big note").
            // A full edge-intersection test is not needed for lasso UX and is
            // expensive for long polygons.
            const visiblePitches = getVisiblePitches(scaleType, scaleRoot, isFolded);
            const path = lassoPathRef.current;

            let pathMinX = Infinity;
            let pathMinY = Infinity;
            let pathMaxX = -Infinity;
            let pathMaxY = -Infinity;
            for (const point of path) {
                if (point.x < pathMinX) {
                    pathMinX = point.x;
                }
                if (point.y < pathMinY) {
                    pathMinY = point.y;
                }
                if (point.x > pathMaxX) {
                    pathMaxX = point.x;
                }
                if (point.y > pathMaxY) {
                    pathMaxY = point.y;
                }
            }

            const pointInPolygon = (px: number, py: number): boolean => {
                let inside = false;
                for (let index = 0, jIndex = path.length - 1; index < path.length; jIndex = index++) {
                    const pi = path[index]!;
                    const pj = path[jIndex]!;
                    if (pi.y > py !== pj.y > py && px < ((pj.x - pi.x) * (py - pi.y)) / (pj.y - pi.y) + pi.x) {
                        inside = !inside;
                    }
                }
                return inside;
            };

            const enclosed = new Set<string>();
            const testLasso = (noteList: MidiNote[]): void => {
                for (const note of noteList) {
                    const row = visiblePitches.indexOf(note.pitch);
                    if (row === -1) {
                        continue;
                    }
                    const nx = note.startBeat * beatWidth;
                    const ny = row * ROW_HEIGHT;
                    const nw = note.duration * beatWidth;
                    const nxMax = nx + nw;
                    const nyMax = ny + ROW_HEIGHT;

                    if (nxMax < pathMinX || nx > pathMaxX || nyMax < pathMinY || ny > pathMaxY) {
                        continue;
                    }

                    const samples: Array<[number, number]> = [
                        [nx, ny],
                        [nxMax, ny],
                        [nx, nyMax],
                        [nxMax, nyMax],
                        [nx + nw / 2, ny + ROW_HEIGHT / 2],
                    ];
                    let hit = samples.some(([px, py]) => pointInPolygon(px, py));
                    if (!hit) {
                        for (const point of path) {
                            if (point.x >= nx && point.x <= nxMax && point.y >= ny && point.y <= nyMax) {
                                hit = true;
                                break;
                            }
                        }
                    }

                    if (hit) {
                        enclosed.add(note.id);
                    }
                }
            };
            testLasso(notes);
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) {
                        continue;
                    }
                    testLasso(openedNotes);
                }
            }
            setSelectedNoteIds(enclosed);
            lassoPathRef.current = [];
        }

        if (drag.mode === 'paint') {
            const paintedIds = [...paintNotesRef.current];
            if (paintedIds.length > 0) {
                const paintedNotes = notes
                    .filter((node) => paintNotesRef.current.has(node.id))
                    .map((node) => ({ ...node }));
                pushUndoEntry(
                    `Paint ${paintedIds.length} note${paintedIds.length > 1 ? 's' : ''}`,
                    () => {
                        for (const id of paintedIds) {
                            removeMidiNote(clipId, id);
                        }
                    },
                    () => {
                        for (const node of paintedNotes) {
                            addMidiNote(clipId, node.pitch, node.startBeat, node.duration, node.velocity);
                        }
                    }
                );
            }
            paintNotesRef.current = new Set();
        }

        dragRef.current = { ...INITIAL_DRAG_STATE };
    };

    const handleDoubleClick = (event: MouseEvent<HTMLCanvasElement>): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
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

    const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNoteIds.size > 0) {
            // A9: group selected notes by owning clip for multi-clip delete
            const notesWithClip: Array<{ note: MidiNote; ownerClipId: string }> = [];
            for (const node of notes) {
                if (selectedNoteIds.has(node.id)) {
                    notesWithClip.push({ note: { ...node }, ownerClipId: clipId });
                }
            }
            if (openedClipNotes) {
                for (const [oid, ns] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) {
                        continue;
                    }
                    for (const node of ns) {
                        if (selectedNoteIds.has(node.id)) {
                            notesWithClip.push({ note: { ...node }, ownerClipId: oid });
                        }
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
                        for (const { note: node, ownerClipId: oid } of notesWithClip) {
                            addMidiNote(oid, node.pitch, node.startBeat, node.duration, node.velocity);
                        }
                    },
                    () => {
                        for (const { note: node, ownerClipId: oid } of notesWithClip) {
                            removeMidiNote(oid, node.id);
                        }
                    }
                );
            }
            setSelectedNoteIds(new Set());
        }
        if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            const allIds = new Set(notes.map((node) => node.id));
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) {
                        continue;
                    }
                    for (const node of openedNotes) {
                        allIds.add(node.id);
                    }
                }
            }
            setSelectedNoteIds(allIds);
        }

        // ── A2: Ctrl/Cmd+D — Duplicate selection forward ───────────────────
        if (event.key === 'd' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
            event.preventDefault();
            // Prevent global arrangement.duplicateClip shortcut from also firing
            event.nativeEvent.stopImmediatePropagation();
            // A9: build targets from both primary and opened clips
            const targetsWithClip: Array<{ note: MidiNote; ownerClipId: string }> = [];
            if (selectedNoteIds.size > 0) {
                for (const node of notes) {
                    if (selectedNoteIds.has(node.id)) {
                        targetsWithClip.push({ note: node, ownerClipId: clipId });
                    }
                }
                if (openedClipNotes) {
                    for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                        if (oid === clipId) {
                            continue;
                        }
                        for (const node of openedNotes) {
                            if (selectedNoteIds.has(node.id)) {
                                targetsWithClip.push({ note: node, ownerClipId: oid });
                            }
                        }
                    }
                }
            } else {
                for (const node of notes) {
                    targetsWithClip.push({ note: node, ownerClipId: clipId });
                }
            }
            if (targetsWithClip.length > 0) {
                const allTargetNotes = targetsWithClip.map((time) => time.note);
                const selStart = Math.min(...allTargetNotes.map((node) => node.startBeat));
                const selEnd = Math.max(...allTargetNotes.map((node) => node.startBeat + node.duration));
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
                        clipNotes.map((node) => ({
                            pitch: node.pitch,
                            startBeat: node.startBeat + span,
                            duration: node.duration,
                            velocity: node.velocity,
                        }))
                    );
                    const ids = copies.map((context) => context.id);
                    allCopyIds.push(...ids);
                    copyByClip.push({ clipId: cid, ids });
                }
                pushUndoEntry(
                    `Duplicate ${targetsWithClip.length} note${targetsWithClip.length > 1 ? 's' : ''} forward`,
                    () => {
                        for (const entry of copyByClip) {
                            removeNotesByIds(entry.clipId, entry.ids);
                        }
                    },
                    () => {
                        for (const [cid, clipNotes] of byClip) {
                            batchAddMidiNotes(
                                cid,
                                clipNotes.map((node) => ({
                                    pitch: node.pitch,
                                    startBeat: node.startBeat + span,
                                    duration: node.duration,
                                    velocity: node.velocity,
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
            const primaryHasSelected = notes.some((node) => selectedNoteIds.has(node.id));
            let ownerClip: string | null = primaryHasSelected ? clipId : null;
            if (openedClipNotes) {
                for (const [oid, openedNotes] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) {
                        continue;
                    }
                    const hasSelected = openedNotes.some((node) => selectedNoteIds.has(node.id));
                    if (hasSelected) {
                        if (ownerClip !== null && ownerClip !== oid) {
                            return null;
                        } // spans multiple clips
                        ownerClip = oid;
                    }
                }
            }
            return ownerClip;
        };

        // ── A4: L — Legato ─────────────────────────────────────────────────
        if (
            event.key === 'l' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !stepInput &&
            selectedNoteIds.size > 0
        ) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                event.preventDefault();
                const ids = [...selectedNoteIds];
                const clipNotesArr = singleClip === clipId ? notes : (openedClipNotes?.[singleClip] ?? []);
                const beforeDurations = clipNotesArr
                    .filter((node) => ids.includes(node.id))
                    .map((node) => ({ id: node.id, duration: node.duration }));
                legatoNotes(singleClip, ids);
                const postNotes = getNotesForClip(singleClip);
                const afterDurations = postNotes
                    .filter((node) => ids.includes(node.id))
                    .map((node) => ({ id: node.id, duration: node.duration }));
                pushUndoEntry(
                    'Legato notes',
                    () => {
                        for (const b of beforeDurations) {
                            resizeMidiNote(singleClip, b.id, undefined, b.duration);
                        }
                    },
                    () => {
                        for (const alpha of afterDurations) {
                            resizeMidiNote(singleClip, alpha.id, undefined, alpha.duration);
                        }
                    }
                );
            }
        }

        // ── A5: Shift+S — Split at cursor ──────────────────────────────────
        if (event.key === 'S' && event.shiftKey && !event.metaKey && !event.ctrlKey && selectedNoteIds.size > 0) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                event.preventDefault();
                event.stopPropagation();
                const playheadBeat = getTransportState()?.playheadPosition ?? 0;
                const ids = [...selectedNoteIds];
                const snapshotBefore = getNotesForClip(singleClip).map((node) => ({ ...node }));
                splitNoteAtBeat(singleClip, ids, playheadBeat);
                const snapshotAfter = getNotesForClip(singleClip).map((node) => ({ ...node }));
                pushUndoEntry(
                    'Split notes at cursor',
                    () => setNotesForClip(singleClip, snapshotBefore),
                    () => setNotesForClip(singleClip, snapshotAfter)
                );
                setSelectedNoteIds(new Set());
            }
        }

        // ── A6: J — Join adjacent same-pitch notes ─────────────────────────
        if (
            event.key === 'j' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !stepInput &&
            selectedNoteIds.size >= 2
        ) {
            const singleClip = getSingleClipForSelection();
            if (singleClip !== null) {
                event.preventDefault();
                const ids = [...selectedNoteIds];
                const snapshotBefore = getNotesForClip(singleClip).map((node) => ({ ...node }));
                joinNotes(singleClip, ids);
                const snapshotAfter = getNotesForClip(singleClip).map((node) => ({ ...node }));
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
            for (const node of notes) {
                if (selectedNoteIds.has(node.id)) {
                    selectedWithClip.push({ note: node, ownerClipId: clipId });
                }
            }
            if (openedClipNotes) {
                for (const [oid, ns] of Object.entries(openedClipNotes)) {
                    if (oid === clipId) {
                        continue;
                    }
                    for (const node of ns) {
                        if (selectedNoteIds.has(node.id)) {
                            selectedWithClip.push({ note: node, ownerClipId: oid });
                        }
                    }
                }
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const delta = event.key === 'ArrowRight' ? gridSnap : -gridSnap;
                const before = selectedWithClip.map(({ note: node, ownerClipId: oid }) => ({
                    id: node.id,
                    clipId: oid,
                    beat: node.startBeat,
                    pitch: node.pitch,
                }));
                for (const { note: node, ownerClipId: oid } of selectedWithClip) {
                    moveMidiNote(oid, node.id, node.pitch, Math.max(0, node.startBeat + delta));
                }
                const after = selectedWithClip.map(({ note: node, ownerClipId: oid }) => ({
                    id: node.id,
                    clipId: oid,
                    beat: Math.max(0, node.startBeat + delta),
                    pitch: node.pitch,
                }));
                pushUndoEntry(
                    `Nudge ${selectedWithClip.length} note${selectedWithClip.length > 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            moveMidiNote(b.clipId, b.id, b.pitch, b.beat);
                        }
                    },
                    () => {
                        for (const alpha of after) {
                            moveMidiNote(alpha.clipId, alpha.id, alpha.pitch, alpha.beat);
                        }
                    }
                );
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const semis = event.shiftKey ? 12 : 1;
                const delta = event.key === 'ArrowUp' ? semis : -semis;
                const before = selectedWithClip.map(({ note: node, ownerClipId: oid }) => ({
                    id: node.id,
                    clipId: oid,
                    pitch: node.pitch,
                    beat: node.startBeat,
                }));
                const after = selectedWithClip.map(({ note: node, ownerClipId: oid }) => ({
                    id: node.id,
                    clipId: oid,
                    pitch: Math.max(0, Math.min(127, node.pitch + delta)),
                    beat: node.startBeat,
                }));
                for (const { note: node, ownerClipId: oid } of selectedWithClip) {
                    moveMidiNote(oid, node.id, Math.max(0, Math.min(127, node.pitch + delta)), node.startBeat);
                }
                pushUndoEntry(
                    `Transpose ${delta > 0 ? '+' : ''}${delta} semitone${Math.abs(delta) !== 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            moveMidiNote(b.clipId, b.id, b.pitch, b.beat);
                        }
                    },
                    () => {
                        for (const alpha of after) {
                            moveMidiNote(alpha.clipId, alpha.id, alpha.pitch, alpha.beat);
                        }
                    }
                );
            }
        }

        if (stepInput) {
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                stepRecordAdvance();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                stepRecordRetreat();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                stepRecordStepUp();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                stepRecordStepDown();
            } else if (event.key === ' ' && event.ctrlKey) {
                const state = stepRecordStore.value;
                if (state) {
                    stepRecordNoteOn(state.currentPitch);
                    stepRecordNoteOff(state.currentPitch);
                }
            } else if (event.key === 'Enter') {
                stepRecordAdvance();
            } else if (event.key === 'Backspace') {
                stepRecordRetreat();
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
            const preset = velocityPresets[event.key];
            if (preset !== undefined) {
                const { noteToClip, allNotesMap } = buildNoteOwnershipMaps(notes, clipId, openedClipNotes);
                const selectedNotesWithClip: Array<{ id: string; clipId: string; velocity: number }> = [];
                for (const id of selectedNoteIds) {
                    const note = allNotesMap.get(id);
                    const ownerClip = noteToClip.get(id);
                    if (note && ownerClip) {
                        selectedNotesWithClip.push({ id, clipId: ownerClip, velocity: note.velocity });
                    }
                }
                for (const item of selectedNotesWithClip) {
                    setNoteVelocity(item.clipId, item.id, preset);
                }
                if (selectedNotesWithClip.length > 0) {
                    pushUndoEntry(
                        'Set velocity',
                        () => {
                            for (const output of selectedNotesWithClip) {
                                setNoteVelocity(output.clipId, output.id, output.velocity);
                            }
                        },
                        () => {
                            for (const output of selectedNotesWithClip) {
                                setNoteVelocity(output.clipId, output.id, preset);
                            }
                        }
                    );
                }
            }
        }
    };

    const handleContextMenu = (event: MouseEvent<HTMLCanvasElement>): void => {
        event.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        setCtxMenu({ x: event.clientX, y: event.clientY, beat: (event.clientX - rect.left) / beatWidth });
    };

    return {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleDoubleClick,
        handleKeyDown,
        handleContextMenu,
        ctxMenu,
        setCtxMenu,
        hoverCursor,
    };
}
