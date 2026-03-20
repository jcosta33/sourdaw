import {
    type ReactElement,
    type MouseEvent as ReactMouseEvent,
    type WheelEvent as ReactWheelEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type Dispatch,
    type SetStateAction,
    useRef,
    useEffect,
    useState,
    useSyncExternalStore,
} from 'react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import {
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    setNoteVelocity,
    humanizeNotes,
    quantizeNotes,
    transposeNotes,
    getNotesForClip,
} from '../../../useCases/workspaceViewActions';
import { copySelectedNotes, pasteNotes } from '../../../useCases/workspaceViewActions';
import { type MidiNote } from '../../../useCases/workspaceViewActions';
import { stampChord, removeNotesByIds, CHORD_TYPE_KEYS, type ChordType } from '#/modules/Track/useCases/chordStamps';
import { strumNotes, restoreStrumOriginals } from '#/modules/Track/useCases/strumNotes';
import { extractGrooveFromClip, applyGrooveToClip, restoreGrooveOriginals } from '#/modules/Track/useCases/grooveExtraction';
import { generateMidiAI, isTauri } from '#/modules/AudioEngine/useCases/nativeAIBridge';

interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const TOTAL_ROWS = 48;
const BASE_PITCH = 36;
const ROW_HEIGHT = 16;
const GRID_BEATS = 32;
const RULER_HEIGHT = 22;

type DragMode = 'none' | 'move' | 'resize-left' | 'resize-right' | 'draw' | 'rubber-band' | 'paint' | 'lasso';
type DragState = {
    mode: DragMode;
    noteId: string | null;
    startX: number;
    startY: number;
    origBeat: number;
    origPitch: number;
    origDuration: number;
    _prevDeltaBeat: number;
    _prevDeltaPitch: number;
};

type PianoRollMenu = { x: number; y: number; beat: number } | null;

const SCALES: Record<string, number[]> = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
    'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
    pentatonic: [0, 2, 4, 7, 9],
    'minor-pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const SCALE_ROOT_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

type PianoRollProps = {
    clipId: string;
    trackId: string;
    selectedNoteIds: Set<string>;
    onSelectedNoteIdsChange: Dispatch<SetStateAction<Set<string>>>;
};

export const PianoRoll = ({ clipId, trackId, selectedNoteIds, onSelectedNoteIdsChange }: PianoRollProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoom, setZoom] = useState(1);
    const [_scrollX, setScrollX] = useState(0);
    const setSelectedNoteIds = onSelectedNoteIdsChange;
    const [gridSnap, setGridSnap] = useState(0.25);
    const [ctxMenu, setCtxMenu] = useState<PianoRollMenu>(null);
    const [hoverCursor, setHoverCursor] = useState<string>('crosshair');
    const ctxMenuRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState>({
        mode: 'none',
        noteId: null,
        startX: 0,
        startY: 0,
        origBeat: 0,
        origPitch: 0,
        origDuration: 1,
        _prevDeltaBeat: 0,
        _prevDeltaPitch: 0,
    });
    const rubberBandRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    const drawPreviewRef = useRef<{ beat: number; pitch: number; duration: number } | null>(null);
    const paintNotesRef = useRef<Set<string>>(new Set());
    const lassoPathRef = useRef<Array<{ x: number; y: number }>>([]);

    const [scaleRoot, setScaleRoot] = useState(0);
    const [scaleType, setScaleType] = useState<string>('chromatic');
    const [stepInput, setStepInput] = useState(false);
    const [stepBeat, setStepBeat] = useState(0);
    const [showGhostNotes, setShowGhostNotes] = useState(true);
    const [chordMode, setChordMode] = useState(false);
    const [chordType, setChordType] = useState<ChordType>('major');
    const [paintMode, setPaintMode] = useState(false);
    const [lassoMode, setLassoMode] = useState(false);

    const beatWidth = Math.max(1, 40 * zoom);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const trackState = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value,
        () => trackStore.value
    );

    const notes = midiState?.notesByClipId[clipId] ?? [];

    const snap = (value: number): number => {
        if (gridSnap <= 0) {
            return value;
        }
        return Math.round(value / gridSnap) * gridSnap;
    };

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.parentElement?.clientWidth ?? GRID_BEATS * beatWidth;
        const noteAreaHeight = TOTAL_ROWS * ROW_HEIGHT;
        const height = noteAreaHeight + RULER_HEIGHT;
        canvas.width = Math.max(width, GRID_BEATS * beatWidth) * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${Math.max(width, GRID_BEATS * beatWidth)}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        const totalWidth = Math.max(width, GRID_BEATS * beatWidth);

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, totalWidth, height);

        // Beat ruler
        ctx.fillStyle = '#16162a';
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

        // Note area (offset by ruler)
        ctx.save();
        ctx.translate(0, RULER_HEIGHT);

        const scaleIntervals = SCALES[scaleType] ?? SCALES.chromatic!;

        for (let row = 0; row < TOTAL_ROWS; row++) {
            const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;
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

        // ── Ghost notes (from other MIDI tracks) ─────────────────────
        if (showGhostNotes && trackState) {
            const otherMidiTracks = trackState.tracks.filter((t) => t.kind === 'midi' && t.id !== trackId);
            for (const otherTrack of otherMidiTracks) {
                const trackColor = otherTrack.color ?? '#888';
                for (const otherClip of otherTrack.clips) {
                    if (otherClip.type !== 'midi') {
                        continue;
                    }
                    const otherNotes = midiState?.notesByClipId[otherClip.id];
                    if (!otherNotes) {
                        continue;
                    }
                    for (const gn of otherNotes) {
                        const row = BASE_PITCH + TOTAL_ROWS - 1 - gn.pitch;
                        if (row < 0 || row >= TOTAL_ROWS) {
                            continue;
                        }
                        const x = gn.startBeat * beatWidth;
                        const y = row * ROW_HEIGHT;
                        const w = gn.duration * beatWidth;

                        ctx.fillStyle = trackColor + '26'; // ~15% opacity hex
                        ctx.beginPath();
                        ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
                        ctx.fill();
                    }
                }
            }
        }

        for (const note of notes) {
            const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
            if (row < 0 || row >= TOTAL_ROWS) {
                continue;
            }
            const x = note.startBeat * beatWidth;
            const y = row * ROW_HEIGHT;
            const w = note.duration * beatWidth;

            const isSelected = selectedNoteIds.has(note.id);
            const alpha = 0.4 + (note.velocity / 127) * 0.6;

            if (isSelected) {
                ctx.fillStyle = `rgba(255, 200, 80, ${alpha})`;
            } else {
                ctx.fillStyle = `rgba(120, 160, 255, ${alpha})`;
            }

            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
            ctx.fill();

            if (isSelected) {
                ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Velocity bar at bottom of note
            const velH = Math.max(1, (note.velocity / 127) * (ROW_HEIGHT - 4));
            ctx.fillStyle = isSelected ? 'rgba(255, 200, 80, 0.35)' : 'rgba(100, 180, 255, 0.3)';
            ctx.fillRect(x + 2, y + ROW_HEIGHT - 2 - velH, Math.max(2, w - 4), velH);

            // Resize handles (left + right edges)
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillRect(x + 1, y + 1, 4, ROW_HEIGHT - 2);
            ctx.fillRect(x + w - 5, y + 1, 4, ROW_HEIGHT - 2);

            if (w > 20) {
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.font = '9px system-ui';
                ctx.fillText(`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`, x + 6, y + 11);
            }
        }

        if (stepInput) {
            const sx = stepBeat * beatWidth;
            ctx.strokeStyle = 'rgba(255, 120, 200, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, noteAreaHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;

            ctx.fillStyle = 'rgba(255, 120, 200, 0.08)';
            const stepW = gridSnap * beatWidth;
            ctx.fillRect(sx, 0, stepW, noteAreaHeight);
        }

        // Draw preview (drag-to-create)
        const dp = drawPreviewRef.current;
        if (dp) {
            const dpRow = BASE_PITCH + TOTAL_ROWS - 1 - dp.pitch;
            const dpX = dp.beat * beatWidth;
            const dpY = dpRow * ROW_HEIGHT;
            const dpW = dp.duration * beatWidth;

            ctx.fillStyle = 'rgba(100, 220, 140, 0.35)';
            ctx.beginPath();
            ctx.roundRect(dpX + 1, dpY + 1, Math.max(4, dpW - 2), ROW_HEIGHT - 2, 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(100, 220, 140, 0.8)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Rubber-band selection rectangle
        const rb = rubberBandRef.current;
        if (rb) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(rb.x, rb.y, rb.w, rb.h);
            ctx.setLineDash([]);
        }

        ctx.restore();
    };

    useEffect(() => {
        draw();
    }, [notes, clipId, zoom, selectedNoteIds, beatWidth, gridSnap, scaleType, scaleRoot, stepInput, stepBeat, showGhostNotes, trackState, trackId, midiState, chordMode, chordType, paintMode, lassoMode]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        let lastScale = 1;

        const onGestureStart = (e: Event) => {
            e.preventDefault();
            lastScale = 1;
        };

        const onGestureChange = (e: Event) => {
            e.preventDefault();
            const ge = e as GestureEvent;
            const delta = ge.scale - lastScale;
            lastScale = ge.scale;
            setZoom((prev) => Math.max(0.25, Math.min(4, prev + delta * 0.5)));
        };

        const onGestureEnd = (e: Event) => {
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
    }, []);

    const hitTest = (x: number, y: number): { note: MidiNote; edge: 'body' | 'left' | 'right' } | null => {
        for (let i = notes.length - 1; i >= 0; i--) {
            const note = notes[i]!;
            const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
            const nx = note.startBeat * beatWidth;
            const ny = row * ROW_HEIGHT;
            const nw = note.duration * beatWidth;

            if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
                if (x <= nx + 8) {
                    return { note, edge: 'left' };
                }
                if (x >= nx + nw - 8) {
                    return { note, edge: 'right' };
                }
                return { note, edge: 'body' };
            }
        }
        return null;
    };

    const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;

        // Click in ruler area — ignore for note editing
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

            // If clicking a note that's already selected (part of multi-selection),
            // keep the selection so the user can drag the group
            if (!selectedNoteIds.has(hit.note.id)) {
                setSelectedNoteIds(new Set([hit.note.id]));
            }

            if (hit.edge === 'left') {
                dragRef.current = {
                    mode: 'resize-left',
                    noteId: hit.note.id,
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
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
                    _prevDeltaBeat: 0,
                    _prevDeltaPitch: 0,
                };
            } else {
                dragRef.current = {
                    mode: 'move',
                    noteId: hit.note.id,
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
                // Alt+click on empty space starts rubber-band selection
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
                // Lasso mode — start freeform selection path
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
            const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;

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
                    // Chord stamp mode — place a full chord
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
                    // Paint mode — place first note, track painted beats
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
                    // Start draw mode — drag to set note length
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
    };

    const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;

        // Hover cursor when not dragging
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
                if (hit) {
                    setHoverCursor(hit.edge === 'body' ? 'grab' : 'ew-resize');
                } else {
                    setHoverCursor('crosshair');
                }
            } else {
                setHoverCursor('crosshair');
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
            const rbX = Math.min(drag.startX, x);
            const rbY = Math.min(drag.startY, noteY);
            const rbW = Math.abs(x - drag.startX);
            const rbH = Math.abs(noteY - drag.startY);
            rubberBandRef.current = { x: rbX, y: rbY, w: rbW, h: rbH };
            draw();
            return;
        }

        if (drag.mode === 'lasso') {
            // Append to freeform lasso path and draw it
            lassoPathRef.current.push({ x, y: noteY });
            draw();

            // Draw lasso path overlay
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx && lassoPathRef.current.length > 1) {
                    ctx.strokeStyle = '#a855f7';
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
            // Fill notes at every grid position between start and current X
            const currentBeat = snap(x / beatWidth);
            const startBeat = drag.origBeat;
            const lowBeat = Math.min(startBeat, currentBeat);
            const highBeat = Math.max(startBeat, currentBeat);

            // Find which grid beats don't have notes yet and add them
            for (let b = lowBeat; b <= highBeat; b += gridSnap) {
                const snappedB = snap(b);
                // Check if a note already exists at this beat + pitch
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
            const duration = Math.max(gridSnap, currentBeat - drag.origBeat);
            drawPreviewRef.current = { beat: drag.origBeat, pitch: drag.origPitch, duration };
            draw();
        } else if (drag.mode === 'move') {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const deltaRow = Math.round((noteY - drag.startY) / ROW_HEIGHT);
            const deltaPitch = -deltaRow;
            // Move ALL selected notes (or just the dragged one if none selected)
            const idsToMove = selectedNoteIds.size > 0 && selectedNoteIds.has(drag.noteId!)
                ? [...selectedNoteIds]
                : [drag.noteId!];
            for (const id of idsToMove) {
                const n = notes.find((nn) => nn.id === id);
                if (!n) {
                    continue;
                }
                // Compute original position for this note based on the delta from the anchor note
                const origN = n; // current position is being updated each move
                const newBeat = Math.max(0, origN.startBeat + deltaBeat - (dragRef.current._prevDeltaBeat ?? 0));
                const newPitch = Math.max(0, Math.min(127, origN.pitch + deltaPitch - (dragRef.current._prevDeltaPitch ?? 0)));
                moveMidiNote(clipId, id, newPitch, newBeat);
            }
            // Track cumulative delta for incremental moves
            dragRef.current._prevDeltaBeat = deltaBeat;
            dragRef.current._prevDeltaPitch = deltaPitch;
        } else if (drag.mode === 'resize-left') {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const newBeat = Math.max(0, drag.origBeat + deltaBeat);
            const endBeat = drag.origBeat + drag.origDuration;
            // Clamp so note doesn't go past its original end
            const clampedBeat = Math.min(newBeat, endBeat - gridSnap);
            const clampedDuration = endBeat - clampedBeat;
            const note = notes.find((n) => n.id === drag.noteId);
            if (note) {
                removeMidiNote(clipId, drag.noteId!);
                addMidiNote(clipId, note.pitch, clampedBeat, clampedDuration, note.velocity);
            }
        } else if (drag.mode === 'resize-right') {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const newDuration = Math.max(gridSnap, drag.origDuration + deltaBeat);
            const note = notes.find((n) => n.id === drag.noteId);
            if (note) {
                removeMidiNote(clipId, drag.noteId!);
                addMidiNote(clipId, note.pitch, note.startBeat, newDuration, note.velocity);
            }
        }
    };

    const handleMouseUp = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;

        if (drag.mode === 'rubber-band') {
            const rb = rubberBandRef.current;
            if (rb && (rb.w > 2 || rb.h > 2)) {
                const rbLeft = rb.x;
                const rbRight = rb.x + rb.w;
                const rbTop = rb.y;
                const rbBottom = rb.y + rb.h;

                const hitIds = new Set<string>();
                for (const note of notes) {
                    const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
                    if (row < 0 || row >= TOTAL_ROWS) {
                        continue;
                    }
                    const nx = note.startBeat * beatWidth;
                    const ny = row * ROW_HEIGHT;
                    const nw = note.duration * beatWidth;
                    const nBottom = ny + ROW_HEIGHT;

                    if (nx + nw > rbLeft && nx < rbRight && nBottom > rbTop && ny < rbBottom) {
                        hitIds.add(note.id);
                    }
                }

                if (e.shiftKey) {
                    setSelectedNoteIds((prev) => new Set([...prev, ...hitIds]));
                } else {
                    setSelectedNoteIds(hitIds);
                }
            }
            rubberBandRef.current = null;
            dragRef.current = {
                mode: 'none',
                noteId: null,
                startX: 0,
                startY: 0,
                origBeat: 0,
                origPitch: 0,
                origDuration: 1,
                _prevDeltaBeat: 0,
                _prevDeltaPitch: 0,
            };
            draw();
            return;
        }

        if (drag.mode === 'draw') {
            const dp = drawPreviewRef.current;
            if (dp) {
                const note = addMidiNote(clipId, dp.pitch, dp.beat, dp.duration, 100);
                pushUndoEntry(
                    'Draw MIDI note',
                    () => removeMidiNote(clipId, note.id),
                    () => addMidiNote(clipId, dp.pitch, dp.beat, dp.duration, 100)
                );
            }
            drawPreviewRef.current = null;
            draw();
        } else if (drag.mode !== 'none' && drag.noteId) {
            const note = notes.find((n) => n.id === drag.noteId);
            if (note) {
                const { noteId, origBeat, origPitch, origDuration, mode } = drag;
                if (mode === 'move') {
                    // Bulk move undo: snapshot all moved notes
                    const movedIds = selectedNoteIds.size > 0 && selectedNoteIds.has(noteId)
                        ? [...selectedNoteIds]
                        : [noteId];
                    const currentPositions = movedIds.map((id) => {
                        const n = notes.find((nn) => nn.id === id);
                        return { id, beat: n?.startBeat ?? 0, pitch: n?.pitch ?? 0 };
                    });
                    const deltaBeat = note.startBeat - origBeat;
                    const deltaPitch = note.pitch - origPitch;
                    if (deltaBeat !== 0 || deltaPitch !== 0) {
                        // Compute original positions by reversing the delta
                        const origPositions = currentPositions.map((p) => ({
                            id: p.id,
                            beat: p.beat - deltaBeat,
                            pitch: p.pitch - deltaPitch,
                        }));
                        pushUndoEntry(
                            `Move ${movedIds.length} note${movedIds.length > 1 ? 's' : ''}`,
                            () => {
                                for (const p of origPositions) {
                                    moveMidiNote(clipId, p.id, p.pitch, p.beat);
                                }
                            },
                            () => {
                                for (const p of currentPositions) {
                                    moveMidiNote(clipId, p.id, p.pitch, p.beat);
                                }
                            }
                        );
                    }
                } else if (
                    (mode === 'resize-right' || mode === 'resize-left') &&
                    (note.duration !== origDuration || note.startBeat !== origBeat)
                ) {
                    const newDuration = note.duration;
                    const newStartBeat = note.startBeat;
                    const savedPitch = note.pitch;
                    const savedVelocity = note.velocity;
                    pushUndoEntry(
                        'Resize MIDI note',
                        () => {
                            removeMidiNote(clipId, noteId);
                            addMidiNote(clipId, savedPitch, origBeat, origDuration, savedVelocity);
                        },
                        () => {
                            removeMidiNote(clipId, noteId);
                            addMidiNote(clipId, savedPitch, newStartBeat, newDuration, savedVelocity);
                        }
                    );
                }
            }
        }
        drawPreviewRef.current = null;

        if (drag.mode === 'lasso' && lassoPathRef.current.length > 2) {
            // Point-in-polygon selection — select notes whose center falls inside the lasso
            const path = lassoPathRef.current;
            const enclosed = new Set<string>();

            for (const note of notes) {
                const cx = (note.startBeat + note.duration / 2) * beatWidth;
                const cy = (TOTAL_ROWS - 1 - (note.pitch - BASE_PITCH)) * ROW_HEIGHT + ROW_HEIGHT / 2;

                // Ray-casting point-in-polygon
                let inside = false;
                for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
                    const pi = path[i]!;
                    const pj = path[j]!;
                    if ((pi.y > cy) !== (pj.y > cy) &&
                        cx < ((pj.x - pi.x) * (cy - pi.y)) / (pj.y - pi.y) + pi.x) {
                        inside = !inside;
                    }
                }
                if (inside) {
                    enclosed.add(note.id);
                }
            }

            setSelectedNoteIds(enclosed);
            lassoPathRef.current = [];
        }

        if (drag.mode === 'paint') {
            // Finalize paint: create undo entry for all painted notes
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

        dragRef.current = {
            mode: 'none',
            noteId: null,
            startX: 0,
            startY: 0,
            origBeat: 0,
            origPitch: 0,
            origDuration: 1,
            _prevDeltaBeat: 0,
            _prevDeltaPitch: 0,
        };
    };

    const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
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
            const { pitch, startBeat, duration, velocity } = hit.note;
            removeMidiNote(clipId, hit.note.id);
            pushUndoEntry(
                'Delete MIDI note',
                () => addMidiNote(clipId, pitch, startBeat, duration, velocity),
                () => removeMidiNote(clipId, hit.note.id)
            );
        }
    };

    const handleWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const isPinch = Math.abs(e.deltaY) < 10;
            const sensitivity = isPinch ? 0.008 : 0.002;
            setZoom((prev) => Math.max(0.25, Math.min(4, prev - e.deltaY * sensitivity)));
        } else {
            setScrollX((prev) => Math.max(0, prev + e.deltaX));
        }
    };

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteIds.size > 0) {
            const deletedNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
            for (const id of selectedNoteIds) {
                removeMidiNote(clipId, id);
            }
            if (deletedNotes.length > 0) {
                pushUndoEntry(
                    `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? 's' : ''}`,
                    () => {
                        for (const n of deletedNotes) {
                            addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                        }
                    },
                    () => {
                        for (const n of deletedNotes) {
                            removeMidiNote(clipId, n.id);
                        }
                    }
                );
            }
            setSelectedNoteIds(new Set());
        }
        if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        }

        // Arrow key nudge for selected notes (when NOT in step mode)
        if (!stepInput && selectedNoteIds.size > 0) {
            const selectedNotes = notes.filter((n) => selectedNoteIds.has(n.id));
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const delta = e.key === 'ArrowRight' ? gridSnap : -gridSnap;
                const before = selectedNotes.map((n) => ({ id: n.id, beat: n.startBeat }));
                for (const n of selectedNotes) {
                    const newBeat = Math.max(0, n.startBeat + delta);
                    moveMidiNote(clipId, n.id, n.pitch, newBeat);
                }
                const after = selectedNotes.map((n) => ({ id: n.id, beat: Math.max(0, n.startBeat + delta) }));
                pushUndoEntry(
                    `Nudge ${selectedNotes.length} note${selectedNotes.length > 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            const note = notes.find((nn) => nn.id === b.id);
                            if (note) {
                                moveMidiNote(clipId, b.id, note.pitch, b.beat);
                            }
                        }
                    },
                    () => {
                        for (const a of after) {
                            const note = notes.find((nn) => nn.id === a.id);
                            if (note) {
                                moveMidiNote(clipId, a.id, note.pitch, a.beat);
                            }
                        }
                    }
                );
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const semis = e.shiftKey ? 12 : 1;
                const delta = e.key === 'ArrowUp' ? semis : -semis;
                const before = selectedNotes.map((n) => ({ id: n.id, pitch: n.pitch }));
                for (const n of selectedNotes) {
                    const newPitch = Math.max(0, Math.min(127, n.pitch + delta));
                    moveMidiNote(clipId, n.id, newPitch, n.startBeat);
                }
                pushUndoEntry(
                    `Transpose ${delta > 0 ? '+' : ''}${delta} semitone${Math.abs(delta) !== 1 ? 's' : ''}`,
                    () => {
                        for (const b of before) {
                            const note = notes.find((nn) => nn.id === b.id);
                            if (note) {
                                moveMidiNote(clipId, b.id, b.pitch, note.startBeat);
                            }
                        }
                    },
                    () => {
                        for (const b of before) {
                            const note = notes.find((nn) => nn.id === b.id);
                            if (note) {
                                moveMidiNote(clipId, b.id, Math.max(0, Math.min(127, b.pitch + delta)), note.startBeat);
                            }
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

    const handleContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        setCtxMenu({ x: e.clientX, y: e.clientY, beat: x / beatWidth });
    };

    useEffect(() => {
        if (!ctxMenu) {
            return;
        }
        const dismiss = (e: MouseEvent) => {
            if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setCtxMenu(null);
            }
        };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', esc);
        };
    }, [ctxMenu]);

    const handleAIGenerate = async () => {
        try {
            const clipNotes = getNotesForClip(clipId);
            const seed = clipNotes.slice(-8).map((n) => [Math.floor(n.pitch), n.velocity, n.startBeat, n.duration] as [number, number, number, number]);
            
            const res = await generateMidiAI(seed, 16);
            if (res && res.notes) {
                for (const note of res.notes) {
                    addMidiNote(clipId, note.pitch, note.start_beat, note.duration_beats, note.velocity);
                }
            }
        } catch {
            console.error('AI Generation requires native backend');
        }
    };

    const ctxAct = (fn: () => void) => () => {
        fn();
        setCtxMenu(null);
    };

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border/30 bg-surface-raised">
                <span className="text-[10px] text-muted-foreground">Snap:</span>
                {[1, 0.5, 0.25, 0.125].map((v) => (
                    <Button
                        key={v}
                        variant={gridSnap === v ? 'secondary' : 'ghost'}
                        size="icon-xs"
                        onClick={() => setGridSnap(v)}
                        className="text-[9px] w-6 h-5"
                    >
                        {v === 1 ? '1' : v === 0.5 ? '1/2' : v === 0.25 ? '1/4' : '1/8'}
                    </Button>
                ))}

                <div className="w-px h-4 bg-border/40 mx-1" />

                <span className="text-[10px] text-muted-foreground">Scale:</span>
                <select
                    value={scaleRoot}
                    onChange={(e) => setScaleRoot(Number(e.target.value))}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Scale root note"
                >
                    {SCALE_ROOT_LABELS.map((label, i) => (
                        <option key={label} value={i}>
                            {label}
                        </option>
                    ))}
                </select>
                <select
                    value={scaleType}
                    onChange={(e) => setScaleType(e.target.value)}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Scale type"
                >
                    {Object.keys(SCALES).map((key) => (
                        <option key={key} value={key}>
                            {key}
                        </option>
                    ))}
                </select>

                <div className="w-px h-4 bg-border/40 mx-1" />

                <Button
                    variant={stepInput ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setStepInput((prev) => !prev)}
                    className={cn('text-[10px] px-2', stepInput && 'text-pink-400 border-pink-400/30')}
                    aria-pressed={stepInput}
                    aria-label="Toggle step input mode"
                >
                    Step
                </Button>

                <div className="w-px h-4 bg-border/40 mx-1" />

                <Button
                    variant={showGhostNotes ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setShowGhostNotes((prev) => !prev)}
                    className={cn('text-[10px] px-2', showGhostNotes && 'text-purple-400 border-purple-400/30')}
                    aria-pressed={showGhostNotes}
                    aria-label="Toggle ghost notes"
                >
                    Ghost
                </Button>

                <Button
                    variant={chordMode ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setChordMode((prev) => !prev)}
                    className={cn('text-[10px] px-2', chordMode && 'text-emerald-400 border-emerald-400/30')}
                    aria-pressed={chordMode}
                    aria-label="Toggle chord stamp mode"
                >
                    Chord
                </Button>

                {chordMode && (
                    <select
                        value={chordType}
                        onChange={(e) => setChordType(e.target.value as ChordType)}
                        className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label="Chord type"
                    >
                        {CHORD_TYPE_KEYS.map((key) => (
                            <option key={key} value={key}>
                                {key}
                            </option>
                        ))}
                    </select>
                )}

                <Button
                    variant={paintMode ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setPaintMode((prev) => !prev)}
                    className={cn('text-[10px] px-2', paintMode && 'text-amber-400 border-amber-400/30')}
                    aria-pressed={paintMode}
                    aria-label="Toggle paint mode"
                >
                    Paint
                </Button>

                <Button
                    variant={lassoMode ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() => setLassoMode((prev) => !prev)}
                    className={cn('text-[10px] px-2', lassoMode && 'text-purple-400 border-purple-400/30')}
                    aria-pressed={lassoMode}
                    aria-label="Toggle magic lasso selection"
                >
                    Lasso
                </Button>

                <div className="flex-1" />
                <span className="text-[10px] text-muted-foreground">Zoom:</span>
                <Slider
                    value={[zoom * 100]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            setZoom(v / 100);
                        }
                    }}
                    min={25}
                    max={400}
                    step={25}
                    className="w-20"
                    aria-label="Piano roll zoom"
                />
            </div>

            <div
                className="flex flex-1 overflow-auto"
                onScroll={(e) => setScrollX((e.target as HTMLElement).scrollLeft)}
            >
                <div className="w-10 shrink-0 border-r border-border/30 bg-surface-raised sticky left-0 z-10">
                    <div className="bg-surface-raised border-b border-border/30" style={{ height: RULER_HEIGHT }} />
                    {Array.from({ length: TOTAL_ROWS }, (_, row) => {
                        const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;
                        const noteIndex = pitch % 12;
                        const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
                        return (
                            <div
                                key={row}
                                className={cn(
                                    'flex items-center justify-end pr-1 text-[8px]',
                                    isBlack ? 'bg-surface-base text-muted-foreground/40' : 'text-muted-foreground/60'
                                )}
                                style={{ height: ROW_HEIGHT }}
                            >
                                {NOTE_NAMES[noteIndex]}
                                {Math.floor(pitch / 12) - 1}
                            </div>
                        );
                    })}
                </div>
                <canvas
                    ref={canvasRef}
                    className="outline-none"
                    style={{ cursor: hoverCursor }}
                    tabIndex={0}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onDoubleClick={handleDoubleClick}
                    onWheel={handleWheel}
                    onKeyDown={handleKeyDown}
                    onContextMenu={handleContextMenu}
                    aria-label="Piano roll editor"
                />
            </div>

            {ctxMenu && (
                <div
                    ref={ctxMenuRef}
                    className="fixed z-50 min-w-[170px] rounded-md border border-border bg-popover py-1 shadow-lg"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    role="menu"
                >
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={ctxAct(() => setSelectedNoteIds(new Set(notes.map((n) => n.id))))}
                    >
                        Select All <span className="ml-auto pl-4 text-muted-foreground">⌘A</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        disabled={selectedNoteIds.size === 0}
                        onClick={ctxAct(() => {
                            copySelectedNotes(clipId, [...selectedNoteIds]);
                        })}
                    >
                        Copy <span className="ml-auto pl-4 text-muted-foreground">⌘C</span>
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        disabled={selectedNoteIds.size === 0}
                        onClick={ctxAct(() => {
                            const cutNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                            copySelectedNotes(clipId, [...selectedNoteIds]);
                            for (const id of selectedNoteIds) {
                                removeMidiNote(clipId, id);
                            }
                            if (cutNotes.length > 0) {
                                pushUndoEntry(
                                    `Cut ${cutNotes.length} note${cutNotes.length > 1 ? 's' : ''}`,
                                    () => {
                                        for (const n of cutNotes) {
                                            addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                                        }
                                    },
                                    () => {
                                        for (const n of cutNotes) {
                                            removeMidiNote(clipId, n.id);
                                        }
                                    }
                                );
                            }
                            setSelectedNoteIds(new Set());
                        })}
                    >
                        Cut <span className="ml-auto pl-4 text-muted-foreground">⌘X</span>
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={ctxAct(() => {
                            pasteNotes(clipId, ctxMenu.beat);
                        })}
                    >
                        Paste <span className="ml-auto pl-4 text-muted-foreground">⌘V</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Quantize</div>
                    <div className="flex gap-1 px-3 py-0.5">
                        {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                            <button
                                type="button"
                                key={g}
                                className="rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent"
                                onClick={ctxAct(() => {
                                    const before = getNotesForClip(clipId).map((n) => ({ ...n }));
                                    quantizeNotes(clipId, g);
                                    const after = getNotesForClip(clipId).map((n) => ({ ...n }));
                                    pushUndoEntry(
                                        `Quantize notes (${g === 1 ? '1/1' : g === 0.5 ? '1/2' : g === 0.25 ? '1/4' : '1/8'})`,
                                        () => {
                                            for (const n of before) {
                                                moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                                            }
                                        },
                                        () => {
                                            for (const n of after) {
                                                moveMidiNote(clipId, n.id, n.pitch, n.startBeat);
                                            }
                                        }
                                    );
                                })}
                            >
                                {g === 1 ? '1/1' : g === 0.5 ? '1/2' : g === 0.25 ? '1/4' : '1/8'}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Transpose</div>
                    <div className="flex gap-1 px-3 py-0.5">
                        {([-12, -1, 1, 12] as const).map((semi) => (
                            <button
                                type="button"
                                key={semi}
                                className="rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent"
                                onClick={ctxAct(() => {
                                    transposeNotes(clipId, semi);
                                    pushUndoEntry(
                                        `Transpose ${semi > 0 ? '+' : ''}${semi} semitone${Math.abs(semi) !== 1 ? 's' : ''}`,
                                        () => transposeNotes(clipId, -semi),
                                        () => transposeNotes(clipId, semi)
                                    );
                                })}
                            >
                                {semi === -12 ? '-Oct' : semi === -1 ? '-1' : semi === 1 ? '+1' : '+Oct'}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    {(
                        [
                            { amount: 0.02, label: 'subtle' },
                            { amount: 0.05, label: 'medium' },
                        ] as const
                    ).map(({ amount, label }) => (
                        <button
                            type="button"
                            key={label}
                            className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                            role="menuitem"
                            onClick={ctxAct(() => {
                                const before = getNotesForClip(clipId).map((n) => ({
                                    id: n.id,
                                    startBeat: n.startBeat,
                                    velocity: n.velocity,
                                }));
                                humanizeNotes(clipId, amount);
                                const after = getNotesForClip(clipId).map((n) => ({
                                    id: n.id,
                                    startBeat: n.startBeat,
                                    velocity: n.velocity,
                                }));
                                pushUndoEntry(
                                    `Humanize (${label})`,
                                    () => {
                                        for (const n of before) {
                                            moveMidiNote(
                                                clipId,
                                                n.id,
                                                notes.find((o) => o.id === n.id)?.pitch ?? 60,
                                                n.startBeat
                                            );
                                            setNoteVelocity(clipId, n.id, n.velocity);
                                        }
                                    },
                                    () => {
                                        for (const n of after) {
                                            moveMidiNote(
                                                clipId,
                                                n.id,
                                                notes.find((o) => o.id === n.id)?.pitch ?? 60,
                                                n.startBeat
                                            );
                                            setNoteVelocity(clipId, n.id, n.velocity);
                                        }
                                    }
                                );
                            })}
                        >
                            Humanize ({label})
                        </button>
                    ))}
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Strum</div>
                    <div className="flex gap-1 px-3 py-0.5">
                        {(['up', 'down'] as const).map((dir) => (
                            <button
                                type="button"
                                key={dir}
                                className="rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent disabled:opacity-40"
                                disabled={selectedNoteIds.size < 2}
                                onClick={ctxAct(() => {
                                    const ids = [...selectedNoteIds];
                                    const originals = strumNotes(clipId, ids, 0.04, dir);
                                    if (originals) {
                                        pushUndoEntry(
                                            `Strum ${dir}`,
                                            () => restoreStrumOriginals(clipId, originals),
                                            () => strumNotes(clipId, ids, 0.04, dir)
                                        );
                                    }
                                })}
                            >
                                {dir === 'up' ? '↑ Up' : '↓ Down'}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-purple-400 font-medium hover:bg-accent"
                        role="menuitem"
                        onClick={ctxAct(handleAIGenerate)}
                    >
                        <span>AI Auto-Complete</span>
                        <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">{isTauri() ? 'Desktop' : 'Web'}</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Groove</div>
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={ctxAct(() => {
                            const groove = extractGrooveFromClip(clipId);
                            if (groove) {
                                ((window as unknown) as Record<string, unknown>).__lastGrooveTemplate = groove;
                            }
                        })}
                    >
                        Extract Groove
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
                        role="menuitem"
                        disabled={!((window as unknown) as Record<string, unknown>).__lastGrooveTemplate}
                        onClick={ctxAct(() => {
                            const groove = ((window as unknown) as Record<string, unknown>).__lastGrooveTemplate;
                            if (groove) {
                                const originals = applyGrooveToClip(clipId, groove as Parameters<typeof applyGrooveToClip>[1], 0.5);
                                if (originals) {
                                    pushUndoEntry(
                                        'Apply groove',
                                        () => restoreGrooveOriginals(clipId, originals),
                                        () => applyGrooveToClip(clipId, groove as Parameters<typeof applyGrooveToClip>[1], 0.5)
                                    );
                                }
                            }
                        })}
                    >
                        Apply Groove (50%)
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                        role="menuitem"
                        disabled={selectedNoteIds.size === 0}
                        onClick={ctxAct(() => {
                            const deletedNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                            for (const id of selectedNoteIds) {
                                removeMidiNote(clipId, id);
                            }
                            if (deletedNotes.length > 0) {
                                pushUndoEntry(
                                    `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? 's' : ''}`,
                                    () => {
                                        for (const n of deletedNotes) {
                                            addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity);
                                        }
                                    },
                                    () => {
                                        for (const n of deletedNotes) {
                                            removeMidiNote(clipId, n.id);
                                        }
                                    }
                                );
                            }
                            setSelectedNoteIds(new Set());
                        })}
                    >
                        Delete Selected <span className="ml-auto pl-4 text-muted-foreground">⌫</span>
                    </button>
                </div>
            )}
        </div>
    );
};
