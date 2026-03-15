import { type ReactElement, useRef, useEffect } from "react";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { Button } from "#/components/ui/button";
import { cn } from "#/helpers/Styles/cn";
import { setWorkspaceMode } from "../../useCases/setWorkspaceMode";
import { addMidiNote, removeMidiNote } from "#/modules/Track/useCases/midiUseCases";
import { useSyncExternalStore } from "react";
import { midiStore } from "#/modules/Track/stores/midiStore";

export const ClipView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

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

    const selectedClip = selectedTrack.clips[0];

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
                <span className="text-xs font-medium text-foreground">{selectedTrack.name}</span>
                {selectedClip && (
                    <span className="text-xs text-muted-foreground">— {selectedClip.name}</span>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => setWorkspaceMode("arrange")}>
                    Back
                </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {selectedTrack.kind === "midi" && selectedClip ? (
                    <PianoRoll clipId={selectedClip.id} />
                ) : selectedClip ? (
                    <WaveformEditor />
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <p className="text-xs text-muted-foreground">No clips on this track. Add a clip first.</p>
                    </div>
                )}
            </div>

            <div className="h-20 border-t border-border/50">
                <VelocityLane clipId={selectedClip?.id ?? null} />
            </div>
        </div>
    );
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const TOTAL_ROWS = 48;
const BASE_PITCH = 36;
const ROW_HEIGHT = 16;
const BEAT_WIDTH = 40;
const GRID_BEATS = 32;

const PianoRoll = ({ clipId }: { clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = midiState?.notesByClipId[clipId] ?? [];

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = GRID_BEATS * BEAT_WIDTH;
        const height = TOTAL_ROWS * ROW_HEIGHT;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, width, height);

        for (let row = 0; row < TOTAL_ROWS; row++) {
            const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;
            const noteIndex = pitch % 12;
            const isBlack = [1, 3, 6, 8, 10].includes(noteIndex);
            const y = row * ROW_HEIGHT;

            if (isBlack) {
                ctx.fillStyle = "rgba(255,255,255,0.02)";
                ctx.fillRect(0, y, width, ROW_HEIGHT);
            }

            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_HEIGHT);
            ctx.lineTo(width, y + ROW_HEIGHT);
            ctx.stroke();

            if (noteIndex === 0) {
                ctx.strokeStyle = "rgba(255,255,255,0.12)";
                ctx.beginPath();
                ctx.moveTo(0, y + ROW_HEIGHT);
                ctx.lineTo(width, y + ROW_HEIGHT);
                ctx.stroke();
            }
        }

        for (let beat = 0; beat <= GRID_BEATS; beat++) {
            const x = beat * BEAT_WIDTH;
            ctx.strokeStyle = beat % 4 === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        for (const note of notes) {
            const row = BASE_PITCH + TOTAL_ROWS - 1 - note.pitch;
            if (row < 0 || row >= TOTAL_ROWS) continue;
            const x = note.startBeat * BEAT_WIDTH;
            const y = row * ROW_HEIGHT;
            const w = note.duration * BEAT_WIDTH;

            const alpha = 0.4 + (note.velocity / 127) * 0.6;
            ctx.fillStyle = `rgba(120, 160, 255, ${alpha})`;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, Math.max(4, w - 2), ROW_HEIGHT - 2, 2);
            ctx.fill();

            if (w > 20) {
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.font = "9px system-ui";
                ctx.fillText(`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`, x + 4, y + 11);
            }
        }
    }, [notes, clipId]);

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const beat = Math.floor(x / BEAT_WIDTH);
        const row = Math.floor(y / ROW_HEIGHT);
        const pitch = BASE_PITCH + TOTAL_ROWS - 1 - row;

        const existingNote = notes.find(
            (n) => n.pitch === pitch && n.startBeat <= beat && n.startBeat + n.duration > beat,
        );

        if (existingNote) {
            removeMidiNote(clipId, existingNote.id);
        } else {
            addMidiNote(clipId, pitch, beat, 1, 100);
        }
    };

    return (
        <div className="flex flex-1 overflow-auto">
            <div className="w-10 shrink-0 border-r border-border/30 bg-surface-raised">
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
                className="cursor-crosshair"
                onClick={handleClick}
                aria-label="Piano roll editor"
            />
        </div>
    );
};

const WaveformEditor = (): ReactElement => {
    return (
        <div className="flex flex-1 items-center justify-center bg-surface-base">
            <div className="flex items-end gap-px h-32">
                {Array.from({ length: 120 }, (_, i) => {
                    const height = Math.abs(Math.sin(i * 0.3) * Math.cos(i * 0.1)) * 100;
                    return (
                        <div
                            key={i}
                            className="w-1 rounded-full bg-foreground/20"
                            style={{ height: `${Math.max(2, height)}%` }}
                        />
                    );
                })}
            </div>
        </div>
    );
};

const VelocityLane = ({ clipId }: { clipId: string | null }): ReactElement => {
    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value,
    );

    const notes = clipId ? (midiState?.notesByClipId[clipId] ?? []) : [];

    if (notes.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">Velocity / Automation Lane</p>
            </div>
        );
    }

    return (
        <div className="flex h-full items-end gap-px px-1 pb-1">
            {notes.map((note) => (
                <div
                    key={note.id}
                    className="w-2 rounded-t bg-blue-400/60"
                    style={{
                        height: `${(note.velocity / 127) * 100}%`,
                        marginLeft: `${note.startBeat * 2}px`,
                    }}
                    title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}: vel ${note.velocity}`}
                />
            ))}
        </div>
    );
};
