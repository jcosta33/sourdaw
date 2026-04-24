import { type ReactElement, type MouseEvent, type PointerEvent, useRef, useLayoutEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { resolveToken } from '#/utils/UI/resolveToken';

import { colorWithAlpha, brightenColor } from '../../helpers/oklchColor';

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
    /** Set the values on multiple notes at once (called during ramp drag). */
    setValues?: (clipId: string, updates: { noteId: string; velocity: number }[]) => void;
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
    setValues,
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

    const selectedNotes = notes.filter((n) => selectedNoteIds.has(n.id));
    const sortedSelected = [...selectedNotes].sort((a, b) => a.startBeat - b.startBeat);

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

    const hitNoteAtX = (mx: number): (typeof notes)[0] | null => {
        for (const note of notes) {
            const nx = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            if (mx >= nx + 1 && mx <= nx + 1 + barW) {
                return note;
            }
        }
        return null;
    };

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
        const h = container.getBoundingClientRect().height;

        const hitNote = hitNoteAtX(mx);

        if (!hitNote) {
            return;
        }

        // ── A7: Shift+drag ramp ────────────────────────────────────────────
        // If Shift is held and 2+ notes are selected, draw a velocity ramp:
        // the first selected note is the anchor (start), the drag target defines the end.
        if (e.shiftKey && sortedSelected.length >= 2) {
            const firstNote = sortedSelected[0]!;
            const lastNote = sortedSelected[sortedSelected.length - 1]!;
            const initialValues = new Map<string, number>(
                sortedSelected.map((n: MidiNote) => [n.id, getValue(n)] as [string, number])
            );
            const startVal = initialValues.get(firstNote.id) ?? getValue(firstNote);
            const beatSpan = lastNote.startBeat - firstNote.startBeat;

            const applyRamp = (endVal: number): void => {
                for (const n of sortedSelected) {
                    let interpolated = startVal;
                    if (beatSpan > 0) {
                        const t = (n.startBeat - firstNote.startBeat) / beatSpan;
                        interpolated = startVal + (endVal - startVal) * t;
                    }
                    setValue(clipId, n.id, Math.round(interpolated));
                }
            };

            const getEndVal = (clientY: number): number => {
                const containerRect = container.getBoundingClientRect();
                const ry = clientY - containerRect.top;
                return Math.round((1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)))) * 127);
            };

            // Apply initial ramp from anchor position
            applyRamp(getEndVal(e.clientY));

            const onMove = (me: globalThis.MouseEvent): void => {
                applyRamp(getEndVal(me.clientY));
            };

            const onUp = (): void => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
                const changes: { id: string; oldVal: number; newVal: number }[] = [];
                for (const [id, oldVal] of initialValues.entries()) {
                    const finalNote = stateNotes.find((n) => n.id === id);
                    if (finalNote) {
                        const newVal = getValue(finalNote);
                        if (newVal !== oldVal) {
                            changes.push({ id, oldVal, newVal });
                        }
                    }
                }
                if (changes.length > 0) {
                    pushUndoEntry(
                        `${undoLabel} ramp`,
                        () => {
                            for (const c of changes) {
                                setValue(clipId, c.id, c.oldVal);
                            }
                        },
                        () => {
                            for (const c of changes) {
                                setValue(clipId, c.id, c.newVal);
                            }
                        }
                    );
                }
            };

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return;
        }

        // ── A8: Continuous velocity painting (single or drag-through) ─────
        const noteId = hitNote.id;
        const origValues = new Map<string, number>(notes.map((n) => [n.id, getValue(n)]));

        const getVal = (clientY: number): number => {
            const containerRect = container.getBoundingClientRect();
            const ry = clientY - containerRect.top;
            return Math.round((1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)))) * 127);
        };

        setValue(clipId, noteId, getVal(e.clientY));

        const onMove = (me: globalThis.MouseEvent): void => {
            const containerRect = container.getBoundingClientRect();
            const rx = me.clientX - containerRect.left;
            const v = getVal(me.clientY);
            // Paint the note currently under the cursor (horizontal movement)
            const noteAtX = hitNoteAtX(rx);
            if (noteAtX) {
                setValue(clipId, noteAtX.id, v);
            }
        };

        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
            const changes: { id: string; oldVal: number; newVal: number }[] = [];
            for (const n of stateNotes) {
                const oldVal = origValues.get(n.id);
                if (oldVal !== undefined) {
                    const newVal = getValue(n);
                    if (newVal !== oldVal) {
                        changes.push({ id: n.id, oldVal, newVal });
                    }
                }
            }
            if (changes.length > 0) {
                pushUndoEntry(
                    undoLabel,
                    () => {
                        for (const c of changes) {
                            setValue(clipId, c.id, c.oldVal);
                        }
                    },
                    () => {
                        for (const c of changes) {
                            setValue(clipId, c.id, c.newVal);
                        }
                    }
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handleRampDrag = (side: 'left' | 'right', e: PointerEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container || sortedSelected.length < 2) {
            return;
        }

        e.stopPropagation();
        e.preventDefault();

        const firstNote = sortedSelected[0];
        const lastNote = sortedSelected[sortedSelected.length - 1];
        if (!firstNote || !lastNote) {
            return;
        }

        const h = container.getBoundingClientRect().height;
        const startLeftVal = getValue(firstNote);
        const startRightVal = getValue(lastNote);

        const initialValues = new Map(sortedSelected.map((n) => [n.id, getValue(n)]));

        const onMove = (me: globalThis.PointerEvent) => {
            const containerRect = container.getBoundingClientRect();
            const ry = me.clientY - containerRect.top;
            const r = 1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)));
            const newVal = Math.round(r * 127);

            const currentLeft = side === 'left' ? newVal : startLeftVal;
            const currentRight = side === 'right' ? newVal : startRightVal;

            const beatSpan = lastNote.startBeat - firstNote.startBeat;

            for (const n of sortedSelected) {
                let interpolated = currentLeft;
                if (beatSpan > 0) {
                    const t = (n.startBeat - firstNote.startBeat) / beatSpan;
                    interpolated = currentLeft + (currentRight - currentLeft) * t;
                }
                setValue(clipId, n.id, Math.round(interpolated));
            }
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);

            const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
            const changes: { id: string; oldVal: number; newVal: number }[] = [];

            for (const [id, oldVal] of initialValues.entries()) {
                const finalNote = stateNotes.find((n) => n.id === id);
                if (finalNote) {
                    const newVal = getValue(finalNote);
                    if (newVal !== oldVal) {
                        changes.push({ id, oldVal, newVal });
                    }
                }
            }

            if (changes.length > 0) {
                pushUndoEntry(
                    `${undoLabel} ramp`,
                    () => {
                        if (setValues) {
                            setValues(
                                clipId,
                                changes.map((c) => ({ noteId: c.id, velocity: c.oldVal }))
                            );
                        } else {
                            for (const c of changes) {
                                setValue(clipId, c.id, c.oldVal);
                            }
                        }
                    },
                    () => {
                        if (setValues) {
                            setValues(
                                clipId,
                                changes.map((c) => ({ noteId: c.id, velocity: c.newVal }))
                            );
                        } else {
                            for (const c of changes) {
                                setValue(clipId, c.id, c.newVal);
                            }
                        }
                    }
                );
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const firstSelected = sortedSelected[0];
    const lastSelected = sortedSelected[sortedSelected.length - 1];

    const leftX = firstSelected
        ? firstSelected.startBeat * beatWidth + Math.max(3, firstSelected.duration * beatWidth - 2) / 2
        : 0;
    const rightX = lastSelected
        ? lastSelected.startBeat * beatWidth + Math.max(3, lastSelected.duration * beatWidth - 2) / 2
        : 0;

    const leftVal = firstSelected ? getValue(firstSelected) : 0;
    const rightVal = lastSelected ? getValue(lastSelected) : 0;

    const getYPercent = (val: number) => `calc(2px + ${1 - val / 127} * (100% - 4px))`;

    return (
        <div ref={containerRef} className="relative h-full w-full" role="group" aria-label={`${label} lane`}>
            <canvas ref={canvasRef} className="cursor-ns-resize" onMouseDown={handleMouseDown} />

            {sortedSelected.length > 1 ? (
                <>
                    <svg className="absolute inset-0 pointer-events-none w-full h-full overflow-visible">
                        <line
                            x1={leftX + 1}
                            y1={getYPercent(leftVal)}
                            x2={rightX + 1}
                            y2={getYPercent(rightVal)}
                            stroke="rgba(255, 255, 255, 0.4)"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                        />
                    </svg>
                    <div
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: leftX + 1, top: getYPercent(leftVal) }}
                        onPointerDown={(e) => handleRampDrag('left', e)}
                    />
                    <div
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: rightX + 1, top: getYPercent(rightVal) }}
                        onPointerDown={(e) => handleRampDrag('right', e)}
                    />
                </>
            ) : null}
        </div>
    );
};
