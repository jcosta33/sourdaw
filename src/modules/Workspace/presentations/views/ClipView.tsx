import { type ReactElement, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent, type KeyboardEvent as ReactKeyboardEvent, type DragEvent as ReactDragEvent, useRef, useEffect, useState, useCallback } from "react";

interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
}
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { Button } from "#/components/ui/button";
import { cn } from "#/helpers/Styles/cn";
import { setWorkspaceMode } from "../../useCases/setWorkspaceMode";
import { addMidiNote, removeMidiNote, moveMidiNote, setNoteVelocity, setNotePressure, setNoteSlide, addMidiCC, removeMidiCC, moveMidiCC, addPitchBend, removePitchBend, movePitchBend, quantizeNotes, transposeNotes, humanizeNotes, getNotesForClip } from "#/modules/Track/useCases/midiUseCases";
import { copySelectedNotes, pasteNotes } from "#/modules/Track/useCases/clipboardUseCases";
import { normalizeClip, reverseClip } from "#/modules/Track/useCases/clipEditingUseCases";
import { useSyncExternalStore } from "react";
import { midiStore } from "#/modules/Track/stores/midiStore";
import { pushUndoEntry } from "#/modules/Command/useCases/pushUndoEntry";
import type { MidiNote, MidiCC, MidiPitchBend } from "#/modules/Track/models/MidiNote";
import { Slider } from "#/components/ui/slider";
import { workspaceStore } from "../../stores/workspaceStore";
import { audioBufferCache } from "#/modules/AudioEngine/stores/audioBufferCache";
import { decodeAudioFile } from "#/modules/AudioEngine/useCases/decodeAudioFile";
import { trackStore } from "#/modules/Track/stores/trackStore";
import type { WarpState } from "#/modules/Track/models/WarpMarker";
import {
    getWarpState,
    enableWarp,
    disableWarp,
    setStretchMode,
    addWarpMarker,
    removeWarpMarker,
} from "#/modules/Track/useCases/warpUseCases";

export const ClipView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

    const wsState = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(() => cb()),
        () => workspaceStore.value,
        () => workspaceStore.value,
    );

    if (!selectedTrack) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3">
                <p className="text-sm text-muted-foreground">Select a track to edit clips</p>
                <Button variant="outline" size="sm" onClick={() => setWorkspaceMode("arrange")}>
                    Back to Arrange
                </Button>
            </div>
        );
    }

    const selectedClip =
        selectedTrack.clips.find((c) => c.id === wsState?.selectedClipId) ??
        selectedTrack.clips[0] ?? null;

    const selectClip = (clipId: string) => {
        if (!wsState) return;
        workspaceStore.set({ ...wsState, selectedClipId: clipId });
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
                <span className="text-xs font-medium text-foreground">{selectedTrack.name}</span>
                {selectedClip && (
                    <span className="text-xs text-muted-foreground">— {selectedClip.name}</span>
                )}
                {selectedTrack.clips.length > 1 && (
                    <div className="flex items-center gap-1 ml-2">
                        {selectedTrack.clips.map((clip) => (
                            <Button
                                key={clip.id}
                                variant={clip.id === selectedClip?.id ? "secondary" : "ghost"}
                                size="icon-xs"
                                className="h-5 w-auto px-1.5 text-[9px]"
                                onClick={() => selectClip(clip.id)}
                            >
                                {clip.name}
                            </Button>
                        ))}
                    </div>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => setWorkspaceMode("arrange")}>
                    Back
                </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {selectedTrack.kind === "midi" && selectedClip ? (
                    <PianoRoll clipId={selectedClip.id} selectedNoteIds={selectedNoteIds} onSelectedNoteIdsChange={setSelectedNoteIds} />
                ) : selectedClip ? (
                    <WaveformEditor clipId={selectedClip.audioBufferId ?? selectedClip.id} />
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <p className="text-xs text-muted-foreground">No clips on this track. Add a clip first.</p>
                    </div>
                )}
            </div>

            <div className="h-28 border-t border-border/50">
                <AutomationLane clipId={selectedClip?.id ?? null} selectedNoteIds={selectedNoteIds} />
            </div>
        </div>
    );
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const TOTAL_ROWS = 48;
const BASE_PITCH = 36;
const ROW_HEIGHT = 16;
const GRID_BEATS = 32;
const RULER_HEIGHT = 22;

type DragMode = "none" | "move" | "resize-right" | "draw" | "rubber-band";
type DragState = {
    mode: DragMode;
    noteId: string | null;
    startX: number;
    startY: number;
    origBeat: number;
    origPitch: number;
    origDuration: number;
};

type PianoRollMenu = { x: number; y: number; beat: number } | null;

const SCALES: Record<string, number[]> = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
    "melodic-minor": [0, 2, 3, 5, 7, 9, 11],
    pentatonic: [0, 2, 4, 7, 9],
    "minor-pentatonic": [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const SCALE_ROOT_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const PianoRoll = ({ clipId, selectedNoteIds, onSelectedNoteIdsChange }: { clipId: string; selectedNoteIds: Set<string>; onSelectedNoteIdsChange: React.Dispatch<React.SetStateAction<Set<string>>> }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoom, setZoom] = useState(1);
    const [scrollX, setScrollX] = useState(0);
    const setSelectedNoteIds = onSelectedNoteIdsChange;
    const [gridSnap, setGridSnap] = useState(0.25);
    const [ctxMenu, setCtxMenu] = useState<PianoRollMenu>(null);
    const ctxMenuRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState>({ mode: "none", noteId: null, startX: 0, startY: 0, origBeat: 0, origPitch: 0, origDuration: 1 });
    const rubberBandRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    const [scaleRoot, setScaleRoot] = useState(0);
    const [scaleType, setScaleType] = useState<string>("chromatic");
    const [stepInput, setStepInput] = useState(false);
    const [stepBeat, setStepBeat] = useState(0);

    const beatWidth = Math.max(1, 40 * zoom);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = midiState?.notesByClipId[clipId] ?? [];

    const snap = (value: number): number => {
        if (gridSnap <= 0) return value;
        return Math.round(value / gridSnap) * gridSnap;
    };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

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

        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, totalWidth, height);

        // Beat ruler
        ctx.fillStyle = "#16162a";
        ctx.fillRect(0, 0, totalWidth, RULER_HEIGHT);
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
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
                ctx.fillStyle = "rgba(255,255,255,0.55)";
                ctx.font = "bold 9px system-ui";
                ctx.fillText(String(barNum), x + 3, 12);
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.beginPath();
                ctx.moveTo(x, 14);
                ctx.lineTo(x, RULER_HEIGHT);
                ctx.stroke();
            } else {
                ctx.strokeStyle = "rgba(255,255,255,0.1)";
                ctx.beginPath();
                ctx.moveTo(x, 16);
                ctx.lineTo(x, RULER_HEIGHT);
                ctx.stroke();
            }

            if (gridSnap < 1) {
                const subdivisions = Math.round(1 / gridSnap);
                for (let sub = 1; sub < subdivisions; sub++) {
                    const sx = x + (sub * beatWidth) / subdivisions;
                    ctx.strokeStyle = "rgba(255,255,255,0.04)";
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
                ctx.fillStyle = "rgba(255,255,255,0.02)";
                ctx.fillRect(0, y, totalWidth, ROW_HEIGHT);
            }

            const relativeNote = (noteIndex - scaleRoot + 12) % 12;
            if (!scaleIntervals.includes(relativeNote)) {
                ctx.fillStyle = "rgba(0,0,0,0.25)";
                ctx.fillRect(0, y, totalWidth, ROW_HEIGHT);
            }

            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_HEIGHT);
            ctx.lineTo(totalWidth, y + ROW_HEIGHT);
            ctx.stroke();

            if (noteIndex === 0) {
                ctx.strokeStyle = "rgba(255,255,255,0.12)";
                ctx.beginPath();
                ctx.moveTo(0, y + ROW_HEIGHT);
                ctx.lineTo(totalWidth, y + ROW_HEIGHT);
                ctx.stroke();
            }
        }

        for (let beat = 0; beat <= totalBeats; beat++) {
            const x = beat * beatWidth;
            ctx.strokeStyle = beat % 4 === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, noteAreaHeight);
            ctx.stroke();

            if (gridSnap < 1) {
                const subdivisions = Math.round(1 / gridSnap);
                for (let sub = 1; sub < subdivisions; sub++) {
                    const sx = x + (sub * beatWidth) / subdivisions;
                    ctx.strokeStyle = "rgba(255,255,255,0.02)";
                    ctx.beginPath();
                    ctx.moveTo(sx, 0);
                    ctx.lineTo(sx, noteAreaHeight);
                    ctx.stroke();
                }
            }
        }

        for (const note of notes) {
            const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
            if (row < 0 || row >= TOTAL_ROWS) continue;
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
                ctx.strokeStyle = "rgba(255, 200, 80, 0.8)";
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(x + w - 4, y + 1, 3, ROW_HEIGHT - 2);

            if (w > 20) {
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.font = "9px system-ui";
                ctx.fillText(`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`, x + 4, y + 11);
            }
        }

        if (stepInput) {
            const sx = stepBeat * beatWidth;
            ctx.strokeStyle = "rgba(255, 120, 200, 0.7)";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, noteAreaHeight);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;

            ctx.fillStyle = "rgba(255, 120, 200, 0.08)";
            const stepW = gridSnap * beatWidth;
            ctx.fillRect(sx, 0, stepW, noteAreaHeight);
        }

        // Rubber-band selection rectangle
        const rb = rubberBandRef.current;
        if (rb) {
            ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
            ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
            ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(rb.x, rb.y, rb.w, rb.h);
            ctx.setLineDash([]);
        }

        ctx.restore();
    }, [notes, clipId, zoom, selectedNoteIds, beatWidth, gridSnap, scaleType, scaleRoot, stepInput, stepBeat]);

    useEffect(() => { draw(); }, [draw]);

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

        canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
        canvas.addEventListener("gesturechange", onGestureChange, { passive: false });
        canvas.addEventListener("gestureend", onGestureEnd, { passive: false });

        return () => {
            canvas.removeEventListener("gesturestart", onGestureStart);
            canvas.removeEventListener("gesturechange", onGestureChange);
            canvas.removeEventListener("gestureend", onGestureEnd);
        };
    }, []);

    const hitTest = (x: number, y: number): { note: MidiNote; edge: "body" | "right" } | null => {
        for (let i = notes.length - 1; i >= 0; i--) {
            const note = notes[i]!;
            const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
            const nx = note.startBeat * beatWidth;
            const ny = row * ROW_HEIGHT;
            const nw = note.duration * beatWidth;

            if (x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_HEIGHT) {
                if (x >= nx + nw - 6) return { note, edge: "right" };
                return { note, edge: "body" };
            }
        }
        return null;
    };

    const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollX;
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
                    if (next.has(hit.note.id)) { next.delete(hit.note.id); }
                    else { next.add(hit.note.id); }
                    return next;
                });
                return;
            }

            setSelectedNoteIds(new Set([hit.note.id]));

            if (hit.edge === "right") {
                dragRef.current = {
                    mode: "resize-right",
                    noteId: hit.note.id,
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
                };
            } else {
                dragRef.current = {
                    mode: "move",
                    noteId: hit.note.id,
                    startX: x,
                    startY: noteY,
                    origBeat: hit.note.startBeat,
                    origPitch: hit.note.pitch,
                    origDuration: hit.note.duration,
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
                    mode: "rubber-band",
                    noteId: null,
                    startX: x,
                    startY: noteY,
                    origBeat: 0,
                    origPitch: 0,
                    origDuration: 0,
                };
                return;
            }

            const row = Math.floor(noteY / ROW_HEIGHT);
            const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;

            if (pitch >= 0 && pitch < 128) {
                if (stepInput) {
                    const note = addMidiNote(clipId, pitch, stepBeat, gridSnap, 100);
                    pushUndoEntry(
                        "Add MIDI note",
                        () => removeMidiNote(clipId, note.id),
                        () => addMidiNote(clipId, pitch, stepBeat, gridSnap, 100),
                    );
                    setStepBeat((prev) => prev + gridSnap);
                    setSelectedNoteIds(new Set());
                } else {
                    const beat = snap(x / beatWidth);
                    const note = addMidiNote(clipId, pitch, beat, gridSnap, 100);
                    pushUndoEntry(
                        "Add MIDI note",
                        () => removeMidiNote(clipId, note.id),
                        () => addMidiNote(clipId, pitch, beat, gridSnap, 100),
                    );
                    setSelectedNoteIds(new Set());
                }
            }
        }
    };

    const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        if (drag.mode === "none") { return; }

        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollX;
        const noteY = e.clientY - rect.top - RULER_HEIGHT;

        if (drag.mode === "rubber-band") {
            const rbX = Math.min(drag.startX, x);
            const rbY = Math.min(drag.startY, noteY);
            const rbW = Math.abs(x - drag.startX);
            const rbH = Math.abs(noteY - drag.startY);
            rubberBandRef.current = { x: rbX, y: rbY, w: rbW, h: rbH };
            draw();
            return;
        }

        if (!drag.noteId) { return; }

        if (drag.mode === "move") {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const deltaRow = Math.round((noteY - drag.startY) / ROW_HEIGHT);
            const newBeat = Math.max(0, drag.origBeat + deltaBeat);
            const newPitch = Math.max(0, Math.min(127, drag.origPitch - deltaRow));
            moveMidiNote(clipId, drag.noteId, newPitch, newBeat);
        } else if (drag.mode === "resize-right") {
            const deltaBeat = snap((x - drag.startX) / beatWidth);
            const newDuration = Math.max(gridSnap, drag.origDuration + deltaBeat);
            const note = notes.find((n) => n.id === drag.noteId);
            if (note) {
                removeMidiNote(clipId, drag.noteId);
                addMidiNote(clipId, note.pitch, note.startBeat, newDuration, note.velocity);
            }
        }
    };

    const handleMouseUp = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;

        if (drag.mode === "rubber-band") {
            const rb = rubberBandRef.current;
            if (rb && (rb.w > 2 || rb.h > 2)) {
                const rbLeft = rb.x;
                const rbRight = rb.x + rb.w;
                const rbTop = rb.y;
                const rbBottom = rb.y + rb.h;

                const hitIds = new Set<string>();
                for (const note of notes) {
                    const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
                    if (row < 0 || row >= TOTAL_ROWS) { continue; }
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
            dragRef.current = { mode: "none", noteId: null, startX: 0, startY: 0, origBeat: 0, origPitch: 0, origDuration: 1 };
            draw();
            return;
        }

        if (drag.mode !== "none" && drag.noteId) {
            const note = notes.find((n) => n.id === drag.noteId);
            if (note) {
                const { noteId, origBeat, origPitch, origDuration, mode } = drag;
                if (mode === "move" && (note.startBeat !== origBeat || note.pitch !== origPitch)) {
                    const newBeat = note.startBeat;
                    const newPitch = note.pitch;
                    pushUndoEntry(
                        "Move MIDI note",
                        () => moveMidiNote(clipId, noteId!, origPitch, origBeat),
                        () => moveMidiNote(clipId, noteId!, newPitch, newBeat),
                    );
                } else if (mode === "resize-right" && note.duration !== origDuration) {
                    const newDuration = note.duration;
                    const savedPitch = note.pitch;
                    const savedBeat = note.startBeat;
                    const savedVelocity = note.velocity;
                    pushUndoEntry(
                        "Resize MIDI note",
                        () => {
                            removeMidiNote(clipId, noteId!);
                            addMidiNote(clipId, savedPitch, savedBeat, origDuration, savedVelocity);
                        },
                        () => {
                            removeMidiNote(clipId, noteId!);
                            addMidiNote(clipId, savedPitch, savedBeat, newDuration, savedVelocity);
                        },
                    );
                }
            }
        }
        dragRef.current = { mode: "none", noteId: null, startX: 0, startY: 0, origBeat: 0, origPitch: 0, origDuration: 1 };
    };

    const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollX;
        const rawY = e.clientY - rect.top;
        if (rawY < RULER_HEIGHT) { return; }
        const noteY = rawY - RULER_HEIGHT;

        const hit = hitTest(x, noteY);
        if (hit) {
            const { pitch, startBeat, duration, velocity } = hit.note;
            removeMidiNote(clipId, hit.note.id);
            pushUndoEntry(
                "Delete MIDI note",
                () => addMidiNote(clipId, pitch, startBeat, duration, velocity),
                () => removeMidiNote(clipId, hit.note.id),
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
        if ((e.key === "Delete" || e.key === "Backspace") && selectedNoteIds.size > 0) {
            const deletedNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
            for (const id of selectedNoteIds) {
                removeMidiNote(clipId, id);
            }
            if (deletedNotes.length > 0) {
                pushUndoEntry(
                    `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? "s" : ""}`,
                    () => { for (const n of deletedNotes) { addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity); } },
                    () => { for (const n of deletedNotes) { removeMidiNote(clipId, n.id); } },
                );
            }
            setSelectedNoteIds(new Set());
        }
        if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            setSelectedNoteIds(new Set(notes.map((n) => n.id)));
        }

        if (stepInput) {
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setStepBeat((prev) => prev + gridSnap);
            }
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                setStepBeat((prev) => Math.max(0, prev - gridSnap));
            }

            const velocityPresets: Record<string, number> = {
                "1": 18, "2": 36, "3": 54, "4": 72, "5": 90, "6": 108, "7": 127,
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
                        "Set velocity",
                        () => { for (const o of origVelocities) { setNoteVelocity(clipId, o.id, o.velocity); } },
                        () => { for (const o of origVelocities) { setNoteVelocity(clipId, o.id, preset); } },
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
        const x = e.clientX - rect.left + scrollX;
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
            if (e.key === "Escape") {
                setCtxMenu(null);
            }
        };
        document.addEventListener("mousedown", dismiss);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", dismiss);
            document.removeEventListener("keydown", esc);
        };
    }, [ctxMenu]);

    const ctxAct = (fn: () => void) => () => { fn(); setCtxMenu(null); };

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border/30 bg-surface-raised">
                <span className="text-[10px] text-muted-foreground">Snap:</span>
                {[1, 0.5, 0.25, 0.125].map((v) => (
                    <Button
                        key={v}
                        variant={gridSnap === v ? "secondary" : "ghost"}
                        size="icon-xs"
                        onClick={() => setGridSnap(v)}
                        className="text-[9px] w-6 h-5"
                    >
                        {v === 1 ? "1" : v === 0.5 ? "1/2" : v === 0.25 ? "1/4" : "1/8"}
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
                        <option key={label} value={i}>{label}</option>
                    ))}
                </select>
                <select
                    value={scaleType}
                    onChange={(e) => setScaleType(e.target.value)}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Scale type"
                >
                    {Object.keys(SCALES).map((key) => (
                        <option key={key} value={key}>{key}</option>
                    ))}
                </select>

                <div className="w-px h-4 bg-border/40 mx-1" />

                <Button
                    variant={stepInput ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setStepInput((prev) => !prev)}
                    className={cn(
                        "text-[10px] px-2",
                        stepInput && "text-pink-400 border-pink-400/30",
                    )}
                    aria-pressed={stepInput}
                    aria-label="Toggle step input mode"
                >
                    Step
                </Button>

                <div className="flex-1" />
                <span className="text-[10px] text-muted-foreground">Zoom:</span>
                <Slider
                    value={[zoom * 100]}
                    onValueChange={([v]) => { if (v !== undefined) setZoom(v / 100); }}
                    min={25}
                    max={400}
                    step={25}
                    className="w-20"
                    aria-label="Piano roll zoom"
                />
            </div>

            <div className="flex flex-1 overflow-auto" onScroll={(e) => setScrollX((e.target as HTMLElement).scrollLeft)}>
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
                                    "flex items-center justify-end pr-1 text-[8px]",
                                    isBlack ? "bg-surface-base text-muted-foreground/40" : "text-muted-foreground/60",
                                )}
                                style={{ height: ROW_HEIGHT }}
                            >
                                {NOTE_NAMES[noteIndex]}{Math.floor(pitch / 12) - 1}
                            </div>
                        );
                    })}
                </div>
                <canvas
                    ref={canvasRef}
                    className="cursor-crosshair outline-none"
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
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={ctxAct(() => setSelectedNoteIds(new Set(notes.map((n) => n.id))))}>
                        Select All <span className="ml-auto pl-4 text-muted-foreground">⌘A</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" disabled={selectedNoteIds.size === 0} onClick={ctxAct(() => {
                        copySelectedNotes(clipId, [...selectedNoteIds]);
                    })}>
                        Copy <span className="ml-auto pl-4 text-muted-foreground">⌘C</span>
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" disabled={selectedNoteIds.size === 0} onClick={ctxAct(() => {
                        const cutNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                        copySelectedNotes(clipId, [...selectedNoteIds]);
                        for (const id of selectedNoteIds) {
                            removeMidiNote(clipId, id);
                        }
                        if (cutNotes.length > 0) {
                            pushUndoEntry(
                                `Cut ${cutNotes.length} note${cutNotes.length > 1 ? "s" : ""}`,
                                () => { for (const n of cutNotes) { addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity); } },
                                () => { for (const n of cutNotes) { removeMidiNote(clipId, n.id); } },
                            );
                        }
                        setSelectedNoteIds(new Set());
                    })}>
                        Cut <span className="ml-auto pl-4 text-muted-foreground">⌘X</span>
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={ctxAct(() => {
                        pasteNotes(clipId, ctxMenu.beat);
                    })}>
                        Paste <span className="ml-auto pl-4 text-muted-foreground">⌘V</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Quantize</div>
                    <div className="flex gap-1 px-3 py-0.5">
                        {([1, 0.5, 0.25, 0.125] as const).map((g) => (
                            <button key={g} className="rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent" onClick={ctxAct(() => {
                                const before = getNotesForClip(clipId).map((n) => ({ ...n }));
                                quantizeNotes(clipId, g);
                                const after = getNotesForClip(clipId).map((n) => ({ ...n }));
                                pushUndoEntry(
                                    `Quantize notes (${g === 1 ? "1/1" : g === 0.5 ? "1/2" : g === 0.25 ? "1/4" : "1/8"})`,
                                    () => { for (const n of before) { moveMidiNote(clipId, n.id, n.pitch, n.startBeat); } },
                                    () => { for (const n of after) { moveMidiNote(clipId, n.id, n.pitch, n.startBeat); } },
                                );
                            })}>
                                {g === 1 ? "1/1" : g === 0.5 ? "1/2" : g === 0.25 ? "1/4" : "1/8"}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Transpose</div>
                    <div className="flex gap-1 px-3 py-0.5">
                        {([-12, -1, 1, 12] as const).map((semi) => (
                            <button key={semi} className="rounded bg-accent/50 px-1.5 py-0.5 text-[9px] hover:bg-accent" onClick={ctxAct(() => {
                                transposeNotes(clipId, semi);
                                pushUndoEntry(
                                    `Transpose ${semi > 0 ? "+" : ""}${semi} semitone${Math.abs(semi) !== 1 ? "s" : ""}`,
                                    () => transposeNotes(clipId, -semi),
                                    () => transposeNotes(clipId, semi),
                                );
                            })}>
                                {semi === -12 ? "-Oct" : semi === -1 ? "-1" : semi === 1 ? "+1" : "+Oct"}
                            </button>
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    {([{ amount: 0.02, label: "subtle" }, { amount: 0.05, label: "medium" }] as const).map(({ amount, label }) => (
                        <button key={label} className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={ctxAct(() => {
                            const before = getNotesForClip(clipId).map((n) => ({ id: n.id, startBeat: n.startBeat, velocity: n.velocity }));
                            humanizeNotes(clipId, amount);
                            const after = getNotesForClip(clipId).map((n) => ({ id: n.id, startBeat: n.startBeat, velocity: n.velocity }));
                            pushUndoEntry(
                                `Humanize (${label})`,
                                () => { for (const n of before) { moveMidiNote(clipId, n.id, notes.find((o) => o.id === n.id)?.pitch ?? 60, n.startBeat); setNoteVelocity(clipId, n.id, n.velocity); } },
                                () => { for (const n of after) { moveMidiNote(clipId, n.id, notes.find((o) => o.id === n.id)?.pitch ?? 60, n.startBeat); setNoteVelocity(clipId, n.id, n.velocity); } },
                            );
                        })}>
                            Humanize ({label})
                        </button>
                    ))}
                    <div className="my-1 border-t border-border/50" />
                    <button className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10" role="menuitem" disabled={selectedNoteIds.size === 0} onClick={ctxAct(() => {
                        const deletedNotes = notes.filter((n) => selectedNoteIds.has(n.id)).map((n) => ({ ...n }));
                        for (const id of selectedNoteIds) {
                            removeMidiNote(clipId, id);
                        }
                        if (deletedNotes.length > 0) {
                            pushUndoEntry(
                                `Delete ${deletedNotes.length} note${deletedNotes.length > 1 ? "s" : ""}`,
                                () => { for (const n of deletedNotes) { addMidiNote(clipId, n.pitch, n.startBeat, n.duration, n.velocity); } },
                                () => { for (const n of deletedNotes) { removeMidiNote(clipId, n.id); } },
                            );
                        }
                        setSelectedNoteIds(new Set());
                    })}>
                        Delete Selected <span className="ml-auto pl-4 text-muted-foreground">⌫</span>
                    </button>
                </div>
            )}
        </div>
    );
};

const STRETCH_MODES: WarpState["stretchMode"][] = ["complex", "repitch", "texture", "beats"];

type WaveformMenu = { x: number; y: number } | null;

const WaveformEditor = ({ clipId }: { clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [bufferVersion, setBufferVersion] = useState(0);
    const [warpState, setWarpState] = useState<WarpState>(() => getWarpState(clipId));
    const [waveCtxMenu, setWaveCtxMenu] = useState<WaveformMenu>(null);
    const waveCtxRef = useRef<HTMLDivElement>(null);

    const refreshWarp = () => setWarpState(getWarpState(clipId));

    const handleToggleWarp = () => {
        if (warpState.enabled) {
            disableWarp(clipId);
        } else {
            enableWarp(clipId);
        }
        refreshWarp();
    };

    const handleStretchMode = (mode: WarpState["stretchMode"]) => {
        setStretchMode(clipId, mode);
        refreshWarp();
    };

    const handleDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (!file || !file.type.startsWith("audio/")) return;

        try {
            const { id: bufferId } = await decodeAudioFile(file);

            const state = trackStore.value;
            if (!state) {
                return;
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    clips: t.clips.map((c) =>
                        c.id === clipId || c.audioBufferId === clipId
                            ? { ...c, audioBufferId: bufferId }
                            : c,
                    ),
                })),
            });
            setBufferVersion((v) => v + 1);
        } catch {
            document.dispatchEvent(new CustomEvent("webdaw:notify", {
                detail: { message: `Failed to import "${file.name}" — unsupported format or corrupt file`, level: "error" },
            }));
        }
    };

    const beatWidth = Math.max(1, 40 * zoom);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth * zoom;
        const height = container.clientHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, width, height);

        const midY = height / 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();

        const peaks = audioBufferCache.getWaveformPeaks(clipId, Math.floor(width));

        const hasRealData = peaks.some((v) => v > 0);

        if (hasRealData) {
            ctx.fillStyle = "rgba(120, 200, 160, 0.6)";
            ctx.beginPath();
            ctx.moveTo(0, midY);
            for (let i = 0; i < peaks.length; i++) {
                ctx.lineTo(i, midY - peaks[i]! * midY * 0.9);
            }
            ctx.lineTo(peaks.length - 1, midY);
            for (let i = peaks.length - 1; i >= 0; i--) {
                ctx.lineTo(i, midY + peaks[i]! * midY * 0.9);
            }
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
            const numBars = Math.floor(width / 3);
            for (let i = 0; i < numBars; i++) {
                const t = i / numBars;
                const amp = Math.abs(Math.sin(t * Math.PI * 8) * Math.cos(t * Math.PI * 3)) * 0.6 + 0.05;
                const barH = amp * height * 0.4;
                ctx.fillRect(i * 3, midY - barH, 2, barH * 2);
            }
            ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
            ctx.font = "11px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Audio clip — drop an audio file to load waveform", width / 2, midY - height * 0.35);
        }

        for (let beat = 0; beat < width / beatWidth; beat++) {
            const x = beat * beatWidth;
            ctx.strokeStyle = beat % 4 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)";
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        if (warpState.enabled) {
            for (const marker of warpState.markers) {
                const x = marker.warpedBeat * beatWidth;
                if (x < 0 || x > width) continue;

                ctx.strokeStyle = "rgba(255, 160, 40, 0.85)";
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineWidth = 1;

                ctx.fillStyle = "rgba(255, 160, 40, 0.9)";
                ctx.beginPath();
                ctx.moveTo(x - 5, 0);
                ctx.lineTo(x + 5, 0);
                ctx.lineTo(x, 8);
                ctx.closePath();
                ctx.fill();

                ctx.font = "9px system-ui";
                ctx.fillStyle = "rgba(255, 160, 40, 0.8)";
                ctx.textAlign = "center";
                ctx.fillText(marker.originalBeat.toFixed(1), x, height - 4);
            }
        }
    }, [clipId, zoom, bufferVersion, warpState, beatWidth]);

    useEffect(() => { draw(); }, [draw]);

    useEffect(() => {
        const observer = new ResizeObserver(() => draw());
        if (containerRef.current) observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [draw]);

    const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (!warpState.enabled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const scrollX = containerRef.current?.scrollLeft ?? 0;
        const x = e.clientX - rect.left + scrollX;
        const beat = x / beatWidth;

        const hitThreshold = 8;
        const hitMarker = warpState.markers.find((m) => {
            const mx = m.warpedBeat * beatWidth;
            return Math.abs(mx - (e.clientX - rect.left + scrollX)) < hitThreshold;
        });

        if (hitMarker) {
            removeWarpMarker(clipId, hitMarker.id);
        } else {
            addWarpMarker(clipId, beat, beat);
        }
        refreshWarp();
    };

    const handleWaveContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        setWaveCtxMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (!waveCtxMenu) {
            return;
        }
        const dismiss = (e: MouseEvent) => {
            if (waveCtxRef.current && !waveCtxRef.current.contains(e.target as Node)) {
                setWaveCtxMenu(null);
            }
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setWaveCtxMenu(null);
            }
        };
        document.addEventListener("mousedown", dismiss);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", dismiss);
            document.removeEventListener("keydown", esc);
        };
    }, [waveCtxMenu]);

    const waveAct = (fn: () => void) => () => { fn(); setWaveCtxMenu(null); };

    const realClipId = trackStore.value?.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.audioBufferId === clipId || c.id === clipId)?.id ?? clipId;

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border/30 bg-surface-raised">
                <span className="text-[10px] text-muted-foreground">Zoom:</span>
                <Slider
                    value={[zoom * 100]}
                    onValueChange={([v]) => { if (v !== undefined) setZoom(v / 100); }}
                    min={25}
                    max={400}
                    step={25}
                    className="w-20"
                    aria-label="Waveform zoom"
                />

                <div className="w-px h-4 bg-border/40 mx-1" />

                <Button
                    variant={warpState.enabled ? "secondary" : "ghost"}
                    size="xs"
                    onClick={handleToggleWarp}
                    className={cn(
                        "text-[10px] px-2",
                        warpState.enabled && "text-orange-400 border-orange-400/30",
                    )}
                    aria-pressed={warpState.enabled}
                    aria-label="Toggle warp mode"
                >
                    Warp
                </Button>

                {warpState.enabled && (
                    <>
                        <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
                            {STRETCH_MODES.map((mode) => (
                                <Button
                                    key={mode}
                                    variant={warpState.stretchMode === mode ? "secondary" : "ghost"}
                                    size="icon-xs"
                                    onClick={() => handleStretchMode(mode)}
                                    className="text-[9px] w-auto px-1.5 h-5 capitalize"
                                    aria-pressed={warpState.stretchMode === mode}
                                >
                                    {mode}
                                </Button>
                            ))}
                        </div>

                        <span className="text-[10px] text-orange-400/70">
                            {warpState.markers.length} marker{warpState.markers.length !== 1 ? "s" : ""}
                        </span>
                    </>
                )}
            </div>
            <div
                ref={containerRef}
                className={cn("flex-1 overflow-auto relative", isDragging && "ring-2 ring-primary ring-inset")}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
            >
                <canvas
                    ref={canvasRef}
                    className="cursor-crosshair"
                    aria-label="Waveform editor"
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleWaveContextMenu}
                />
                {isDragging && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/10 pointer-events-none">
                        <span className="text-sm font-medium text-primary">Drop audio file here</span>
                    </div>
                )}
            </div>

            {waveCtxMenu && (
                <div
                    ref={waveCtxRef}
                    className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
                    style={{ left: waveCtxMenu.x, top: waveCtxMenu.y }}
                    role="menu"
                >
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={waveAct(() => normalizeClip(realClipId))}>
                        Normalize
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={waveAct(() => reverseClip(realClipId))}>
                        Reverse
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={waveAct(() => {
                        if (warpState.enabled) {
                            disableWarp(clipId);
                        } else {
                            enableWarp(clipId);
                        }
                        refreshWarp();
                    })}>
                        {warpState.enabled ? "Disable Warp" : "Enable Warp"}
                    </button>
                </div>
            )}
        </div>
    );
};

type LaneMode =
    | { kind: "velocity" }
    | { kind: "cc"; controller: number; label: string }
    | { kind: "pitchBend" }
    | { kind: "pressure" }
    | { kind: "slide" };

const LANE_OPTIONS: { value: string; label: string; mode: LaneMode }[] = [
    { value: "velocity", label: "Velocity", mode: { kind: "velocity" } },
    { value: "pressure", label: "Pressure", mode: { kind: "pressure" } },
    { value: "slide", label: "Slide (CC74)", mode: { kind: "slide" } },
    { value: "cc1", label: "CC 1 (Mod Wheel)", mode: { kind: "cc", controller: 1, label: "Mod Wheel" } },
    { value: "cc7", label: "CC 7 (Volume)", mode: { kind: "cc", controller: 7, label: "Volume" } },
    { value: "cc10", label: "CC 10 (Pan)", mode: { kind: "cc", controller: 10, label: "Pan" } },
    { value: "cc11", label: "CC 11 (Expression)", mode: { kind: "cc", controller: 11, label: "Expression" } },
    { value: "cc64", label: "CC 64 (Sustain)", mode: { kind: "cc", controller: 64, label: "Sustain" } },
    { value: "pitchBend", label: "Pitch Bend", mode: { kind: "pitchBend" } },
];

const AutomationLane = ({ clipId, selectedNoteIds }: { clipId: string | null; selectedNoteIds: Set<string> }): ReactElement => {
    const [selectedLane, setSelectedLane] = useState("velocity");

    const laneOption = LANE_OPTIONS.find((o) => o.value === selectedLane) ?? LANE_OPTIONS[0]!;
    const mode = laneOption.mode;

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-2 py-0.5 border-b border-border/30 bg-surface-raised shrink-0">
                <label htmlFor="lane-selector" className="text-[9px] text-muted-foreground shrink-0">
                    Lane:
                </label>
                <select
                    id="lane-selector"
                    value={selectedLane}
                    onChange={(e) => setSelectedLane(e.target.value)}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Automation lane type"
                >
                    {LANE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex-1 min-h-0">
                {mode.kind === "velocity" ? (
                    <VelocityLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === "pressure" ? (
                    <PressureLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === "slide" ? (
                    <SlideLane clipId={clipId} selectedNoteIds={selectedNoteIds} />
                ) : mode.kind === "cc" ? (
                    <CCLane clipId={clipId} controller={mode.controller} />
                ) : (
                    <PitchBendLane clipId={clipId} />
                )}
            </div>
        </div>
    );
};

const VelocityLane = ({ clipId, selectedNoteIds }: { clipId: string | null; selectedNoteIds: Set<string> }): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to see velocity</p>
            </div>
        );
    }

    const handleVelocityDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origVelocity = notes.find((n) => n.id === noteId)?.velocity ?? 100;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const velocity = Math.round(ratio * 127);
            setNoteVelocity(clipId, noteId, velocity);
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalVelocity = finalNote?.velocity ?? origVelocity;
            if (finalVelocity !== origVelocity) {
                pushUndoEntry(
                    "Change velocity",
                    () => setNoteVelocity(clipId, noteId, origVelocity),
                    () => setNoteVelocity(clipId, noteId, finalVelocity),
                );
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Velocity lane">
            {notes.map((note) => {
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            "w-3 rounded-t cursor-ns-resize transition-colors",
                            isSelected
                                ? "bg-amber-400/80 hover:bg-amber-400"
                                : "bg-blue-400/30 hover:bg-blue-400/50",
                        )}
                        style={{
                            height: `${(note.velocity / 127) * 100}%`,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: vel ${note.velocity}`}
                        onMouseDown={(e) => handleVelocityDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};

const PressureLane = ({ clipId, selectedNoteIds }: { clipId: string | null; selectedNoteIds: Set<string> }): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to edit pressure</p>
            </div>
        );
    }

    const handlePressureDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origPressure = notes.find((n) => n.id === noteId)?.pressure ?? 0;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const pressure = Math.round(ratio * 127);
            setNotePressure(clipId, noteId, pressure);
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalPressure = finalNote?.pressure ?? origPressure;
            if (finalPressure !== origPressure) {
                pushUndoEntry(
                    "Change pressure",
                    () => setNotePressure(clipId, noteId, origPressure),
                    () => setNotePressure(clipId, noteId, finalPressure),
                );
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Pressure lane">
            {notes.map((note) => {
                const pressure = note.pressure ?? 0;
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            "w-3 rounded-t cursor-ns-resize transition-colors",
                            isSelected
                                ? "bg-violet-300/80 hover:bg-violet-300"
                                : "bg-violet-500/30 hover:bg-violet-500/50",
                        )}
                        style={{
                            height: `${(pressure / 127) * 100}%`,
                            minHeight: pressure > 0 ? "2px" : undefined,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: pressure ${pressure}`}
                        onMouseDown={(e) => handlePressureDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};

const SlideLane = ({ clipId, selectedNoteIds }: { clipId: string | null; selectedNoteIds: Set<string> }): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No notes — add MIDI notes to edit slide</p>
            </div>
        );
    }

    const handleSlideDrag = (noteId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = e.currentTarget.parentElement;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const origSlide = notes.find((n) => n.id === noteId)?.slide ?? 0;

        const onMove = (me: MouseEvent) => {
            const y = me.clientY - rect.top;
            const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
            const slide = Math.round(ratio * 127);
            setNoteSlide(clipId, noteId, slide);
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalSlide = finalNote?.slide ?? origSlide;
            if (finalSlide !== origSlide) {
                pushUndoEntry(
                    "Change slide",
                    () => setNoteSlide(clipId, noteId, origSlide),
                    () => setNoteSlide(clipId, noteId, finalSlide),
                );
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1 relative" role="group" aria-label="Slide lane">
            {notes.map((note) => {
                const slide = note.slide ?? 0;
                const isSelected = selectedNoteIds.has(note.id);
                return (
                    <div
                        key={note.id}
                        className={cn(
                            "w-3 rounded-t cursor-ns-resize transition-colors",
                            isSelected
                                ? "bg-teal-300/80 hover:bg-teal-300"
                                : "bg-teal-500/30 hover:bg-teal-500/50",
                        )}
                        style={{
                            height: `${(slide / 127) * 100}%`,
                            minHeight: slide > 0 ? "2px" : undefined,
                            marginLeft: `${note.startBeat * 3}px`,
                        }}
                        title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: slide ${slide}`}
                        onMouseDown={(e) => handleSlideDrag(note.id, e)}
                    />
                );
            })}
        </div>
    );
};

const CCLane = ({ clipId, controller }: { clipId: string | null; controller: number }): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const allCc = clipId ? (midiState?.ccByClipId[clipId] ?? []) : [];
    const points = [...allCc.filter((c: MidiCC) => c.controller === controller)]
        .sort((a: MidiCC, b: MidiCC) => a.beat - b.beat);

    const beatScale = 3;

    const beatToX = (beat: number): number => beat * beatScale + 8;
    const valueToY = (value: number, height: number): number =>
        height - (value / 127) * (height - 8) - 4;

    const handleContainerClick = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) return;
        const container = containerRef.current;
        if (!container) return;

        if ((e.target as HTMLElement).dataset.ccPoint) return;

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const height = rect.height;

        const beat = Math.max(0, (x - 8) / beatScale);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const cc = addMidiCC(clipId, controller, value, beat);
        pushUndoEntry(
            "Add CC point",
            () => removeMidiCC(clipId, cc.id),
            () => addMidiCC(clipId, controller, value, beat),
        );
    };

    const handlePointMouseDown = (ccId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) return;
        const container = containerRef.current;
        if (!container) return;

        const origPoint = points.find((p) => p.id === ccId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        setDragId(ccId);
        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = (me: MouseEvent) => {
            const x = me.clientX - rect.left;
            const y = me.clientY - rect.top;

            const beat = Math.max(0, (x - 8) / beatScale);
            const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

            moveMidiCC(clipId, ccId, beat, value);
        };

        const onUp = () => {
            setDragId(null);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const finalPoint = (midiStore.value?.ccByClipId[clipId] ?? []).find((c) => c.id === ccId);
            if (finalPoint && (finalPoint.beat !== origBeat || finalPoint.value !== origValue)) {
                const finalBeat = finalPoint.beat;
                const finalValue = finalPoint.value;
                pushUndoEntry(
                    "Move CC point",
                    () => moveMidiCC(clipId, ccId, origBeat, origValue),
                    () => moveMidiCC(clipId, ccId, finalBeat, finalValue),
                );
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const handlePointDoubleClick = (ccId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) return;
        const point = points.find((p) => p.id === ccId);
        if (point) {
            const { controller: ctrl, value, beat, channel } = point;
            removeMidiCC(clipId, ccId);
            pushUndoEntry(
                "Remove CC point",
                () => addMidiCC(clipId, ctrl, value, beat, channel),
                () => removeMidiCC(clipId, ccId),
            );
        } else {
            removeMidiCC(clipId, ccId);
        }
    };

    if (!clipId) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No clip selected</p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            onClick={handleContainerClick}
            role="group"
            aria-label={`CC ${controller} automation lane`}
        >
            {points.length > 1 && (
                <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                    <polyline
                        fill="none"
                        stroke="rgba(168, 130, 255, 0.5)"
                        strokeWidth="1.5"
                        points={points.map((p: MidiCC) => {
                            const el = containerRef.current;
                            const h = el?.clientHeight ?? 80;
                            return `${beatToX(p.beat)},${valueToY(p.value, h)}`;
                        }).join(" ")}
                    />
                </svg>
            )}

            {points.map((point: MidiCC) => {
                const el = containerRef.current;
                const h = el?.clientHeight ?? 80;
                const x = beatToX(point.beat);
                const y = valueToY(point.value, h);
                const isDragging = dragId === point.id;

                return (
                    <div
                        key={point.id}
                        data-cc-point="true"
                        className={cn(
                            "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-purple-400 cursor-grab transition-shadow",
                            isDragging
                                ? "bg-purple-300 shadow-[0_0_6px_rgba(168,130,255,0.6)] cursor-grabbing"
                                : "bg-purple-400/80 hover:bg-purple-300 hover:shadow-[0_0_4px_rgba(168,130,255,0.4)]",
                        )}
                        style={{ left: x, top: y }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value}`}
                        onMouseDown={(e) => handlePointMouseDown(point.id, e)}
                        onDoubleClick={(e) => handlePointDoubleClick(point.id, e)}
                    />
                );
            })}

            {points.length === 0 && (
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">Click to add CC points</p>
                </div>
            )}
        </div>
    );
};

const PITCH_BEND_CENTER = 64;

const PitchBendLane = ({ clipId }: { clipId: string | null }): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const allPb = clipId ? (midiState?.pitchBendByClipId[clipId] ?? []) : [];
    const points = [...allPb].sort((a: MidiPitchBend, b: MidiPitchBend) => a.beat - b.beat);

    const beatScale = 3;

    const beatToX = (beat: number): number => beat * beatScale + 8;
    const valueToY = (value: number, height: number): number =>
        height - (value / 127) * (height - 8) - 4;

    const handleContainerClick = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }

        if ((e.target as HTMLElement).dataset.pbPoint) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const height = rect.height;

        const beat = Math.max(0, (x - 8) / beatScale);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const pb = addPitchBend(clipId, value, beat);
        pushUndoEntry(
            "Add pitch bend point",
            () => removePitchBend(clipId, pb.id),
            () => addPitchBend(clipId, value, beat),
        );
    };

    const handlePointMouseDown = (pbId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const origPoint = points.find((p) => p.id === pbId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        setDragId(pbId);
        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = (me: MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatScale);
            const value = Math.round(Math.max(0, Math.min(127, ((height - my - 4) / (height - 8)) * 127)));

            movePitchBend(clipId, pbId, beat, value);
        };

        const onUp = () => {
            setDragId(null);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            const finalPoint = (midiStore.value?.pitchBendByClipId[clipId] ?? []).find((p) => p.id === pbId);
            if (finalPoint && (finalPoint.beat !== origBeat || finalPoint.value !== origValue)) {
                const finalBeat = finalPoint.beat;
                const finalValue = finalPoint.value;
                pushUndoEntry(
                    "Move pitch bend point",
                    () => movePitchBend(clipId, pbId, origBeat, origValue),
                    () => movePitchBend(clipId, pbId, finalBeat, finalValue),
                );
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const handlePointDoubleClick = (pbId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const point = points.find((p) => p.id === pbId);
        if (point) {
            const { value, beat, channel } = point;
            removePitchBend(clipId, pbId);
            pushUndoEntry(
                "Remove pitch bend point",
                () => addPitchBend(clipId, value, beat, channel),
                () => removePitchBend(clipId, pbId),
            );
        } else {
            removePitchBend(clipId, pbId);
        }
    };

    if (!clipId) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No clip selected</p>
            </div>
        );
    }

    const containerHeight = containerRef.current?.clientHeight ?? 80;
    const centerY = valueToY(PITCH_BEND_CENTER, containerHeight);

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            onClick={handleContainerClick}
            role="group"
            aria-label="Pitch bend automation lane"
        >
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                <line
                    x1="0"
                    y1={centerY}
                    x2="100%"
                    y2={centerY}
                    stroke="rgba(255, 255, 255, 0.12)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                />
                {points.length > 1 && (
                    <polyline
                        fill="none"
                        stroke="rgba(80, 180, 220, 0.5)"
                        strokeWidth="1.5"
                        points={points.map((p: MidiPitchBend) => {
                            const h = containerRef.current?.clientHeight ?? 80;
                            return `${beatToX(p.beat)},${valueToY(p.value, h)}`;
                        }).join(" ")}
                    />
                )}
            </svg>

            {points.map((point: MidiPitchBend) => {
                const h = containerRef.current?.clientHeight ?? 80;
                const x = beatToX(point.beat);
                const y = valueToY(point.value, h);
                const isDragging = dragId === point.id;

                return (
                    <div
                        key={point.id}
                        data-pb-point="true"
                        className={cn(
                            "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400 cursor-grab transition-shadow",
                            isDragging
                                ? "bg-cyan-300 shadow-[0_0_6px_rgba(80,180,220,0.6)] cursor-grabbing"
                                : "bg-cyan-400/80 hover:bg-cyan-300 hover:shadow-[0_0_4px_rgba(80,180,220,0.4)]",
                        )}
                        style={{ left: x, top: y }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value} (center: ${PITCH_BEND_CENTER})`}
                        onMouseDown={(e) => handlePointMouseDown(point.id, e)}
                        onDoubleClick={(e) => handlePointDoubleClick(point.id, e)}
                    />
                );
            })}

            {points.length === 0 && (
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">Click to add pitch bend points (center = no bend)</p>
                </div>
            )}
        </div>
    );
};
