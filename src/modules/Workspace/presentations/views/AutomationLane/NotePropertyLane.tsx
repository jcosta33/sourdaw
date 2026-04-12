import { type ReactElement, type MouseEvent, useRef, useLayoutEffect } from 'react';
import { midiStore } from '#/modules/MIDI/stores';
import { trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';
import { colorWithAlpha, brightenColor } from '../../helpers/oklchColor';
import { useStore } from '#/infra/store/useStore';

type MidiNote = NonNullable<typeof midiStore.value>['notesByClipId'][string][number];

type MidiLaneStoreState = {
    notesByClipId: Record<string, MidiNote[]>;
    ccByClipId: Record<string, unknown[]>;
    pitchBendByClipId: Record<string, unknown[]>;
};

type NotePropertyTrackState = {
    tracks: Array<{
        id: string;
        color?: string;
        clips: Array<{
            id: string;
            color?: string;
        }>;
    }>;
    selectedTrackId: string | null;
};

type NotePropertyLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
    /** Extract the 0–127 value from a note for display. */
    getValue: (note: MidiNote) => number;
    /** Set the value on the note (called during drag). */
    setValue: (clipId: string, noteId: string, value: number) => void;
    /** Label for the lane (used in aria-label and empty-state text). */
    label: string;
    /** Undo action label, e.g. "Change velocity". */
    undoLabel: string;
};

export const NotePropertyLane = ({
    clipId,
    trackId,
    selectedNoteIds,
    beatWidth,
    contentWidth,
    getValue,
    setValue,
    label,
    undoLabel,
}: NotePropertyLaneProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const midiState = useStore<MidiLaneStoreState>(midiStore, {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    const trackState = useStore<NotePropertyTrackState>(trackStore, {
        tracks: [],
        selectedTrackId: null,
    });

    const notes = clipId ? (midiState.notesByClipId[clipId] ?? []) : [];

    const activeTrack = trackState.tracks.find((t) => t.id === trackId);
    const activeClip = activeTrack?.clips.find((c) => c.id === clipId);
    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';
    const selectedColor = brightenColor(clipColor, 0.22);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.getBoundingClientRect().width;
        const w = Math.max(containerWidth, contentWidth);
        const h = container.getBoundingClientRect().height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.scale(dpr, dpr);

        ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
        ctx.fillRect(0, 0, w, h);

        if (notes.length === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(`No notes — add MIDI to edit ${label.toLowerCase()}`, w / 2, h / 2 + 4);
            return;
        }

        for (const note of notes) {
            const val = getValue(note);
            const x = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            const barH = (val / 127) * (h - 4);
            const barY = h - barH - 2;
            const isSelected = selectedNoteIds.has(note.id);

            const noteColor = isSelected ? selectedColor : clipColor;
            const alpha = 0.35 + (val / 127) * 0.55;

            ctx.fillStyle = colorWithAlpha(noteColor, alpha);
            ctx.beginPath();
            ctx.roundRect(x + 1, barY, barW, barH, [2, 2, 0, 0]);
            ctx.fill();

            ctx.strokeStyle = colorWithAlpha(noteColor, isSelected ? 0.6 : 0.25);
            ctx.lineWidth = 0.5;
            ctx.stroke();

            if (barW > 14) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '7px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(String(val), x + 1 + barW / 2, barY - 2);
            }
        }
    }, [notes, selectedNoteIds, beatWidth, contentWidth, clipColor, selectedColor, getValue, label]);

    const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>): void => {
        if (!clipId) {
            return;
        }
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const h = container.getBoundingClientRect().height;

        let hitNote: (typeof notes)[0] | null = null;
        for (const note of notes) {
            const x = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            if (mx >= x + 1 && mx <= x + 1 + barW) {
                hitNote = note;
                break;
            }
        }

        if (!hitNote) {
            return;
        }

        const noteId = hitNote.id;
        const origValue = getValue(hitNote);

        const ratio = 1 - Math.max(0, Math.min(1, (my - 2) / (h - 4)));
        const value = Math.round(ratio * 127);
        setValue(clipId, noteId, value);

        const onMove = (me: globalThis.MouseEvent): void => {
            const containerRect = container.getBoundingClientRect();
            const ry = me.clientY - containerRect.top;
            const r = 1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)));
            const v = Math.round(r * 127);
            setValue(clipId, noteId, v);
        };

        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalNote = (midiStore.value?.notesByClipId[clipId] ?? []).find((n) => n.id === noteId);
            const finalValue = finalNote ? getValue(finalNote) : origValue;
            if (finalValue !== origValue) {
                pushUndoEntry(
                    undoLabel,
                    () => setValue(clipId, noteId, origValue),
                    () => setValue(clipId, noteId, finalValue)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div ref={containerRef} className="relative h-full w-full" role="group" aria-label={`${label} lane`}>
            <canvas ref={canvasRef} className="cursor-ns-resize" onMouseDown={handleMouseDown} />
        </div>
    );
};
