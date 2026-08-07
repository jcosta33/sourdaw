import { type ReactElement, type PointerEvent, useRef, useLayoutEffect, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
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

type LanePointerPosition = {
    clientX: number;
    clientY: number;
};

/**
 * One in-flight drag gesture. The pointer is captured on `captureTarget`, so every
 * subsequent event for `pointerId` is retargeted there by the browser — no window
 * listeners, and a release outside the window still arrives as pointerup/pointercancel.
 */
type LaneDragSession = {
    pointerId: number;
    captureTarget: Element;
    move: (position: LanePointerPosition) => void;
    commit: () => void;
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
    const dragSessionRef = useRef<LaneDragSession | null>(null);
    const finalizeDragRef = useRef<() => void>(() => {});

    const finalizeDrag = (): void => {
        const session = dragSessionRef.current;
        if (!session) {
            return;
        }
        dragSessionRef.current = null;
        try {
            session.captureTarget.releasePointerCapture(session.pointerId);
        } catch {
            // The browser releases capture itself on pointercancel and on element removal.
        }
        session.commit();
    };

    useLayoutEffect(() => {
        finalizeDragRef.current = finalizeDrag;
    });

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finalizeDragRef.current();
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finalizeDragRef.current();
            }
        };

        window.addEventListener('blur', handleWindowBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('blur', handleWindowBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        return () => {
            finalizeDragRef.current();
        };
    }, []);

    const beginDrag = (session: LaneDragSession): void => {
        session.captureTarget.setPointerCapture(session.pointerId);
        dragSessionRef.current = session;
    };

    const handleDragMove = (event: PointerEvent<Element>): void => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        session.move({ clientX: event.clientX, clientY: event.clientY });
    };

    const handleDragEnd = (event: PointerEvent<Element>): void => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        finalizeDrag();
    };

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

    const activeTrack = trackState.tracks.find((time) => time.id === trackId);
    const activeClip = activeTrack?.clips.find((context) => context.id === clipId);
    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';
    const selectedColor = brightenColor(clipColor, 0.22);

    const selectedNotes = notes.filter((node) => selectedNoteIds.has(node.id));
    const sortedSelected = [...selectedNotes].sort((alpha, b) => alpha.startBeat - b.startBeat);

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

    const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
        if (!clipId || dragSessionRef.current) {
            return;
        }
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const h = container.getBoundingClientRect().height;

        const hitNote = hitNoteAtX(mx);

        if (!hitNote) {
            return;
        }

        // ── A7: Shift+drag ramp ────────────────────────────────────────────
        // If Shift is held and 2+ notes are selected, draw a velocity ramp:
        // the first selected note is the anchor (start), the drag target defines the end.
        if (event.shiftKey && sortedSelected.length >= 2) {
            const firstNote = sortedSelected[0]!;
            const lastNote = sortedSelected[sortedSelected.length - 1]!;
            const initialValues = new Map<string, number>(
                sortedSelected.map((node: MidiNote) => [node.id, getValue(node)] as [string, number])
            );
            const startVal = initialValues.get(firstNote.id) ?? getValue(firstNote);
            const beatSpan = lastNote.startBeat - firstNote.startBeat;

            const applyRamp = (endVal: number): void => {
                for (const node of sortedSelected) {
                    let interpolated = startVal;
                    if (beatSpan > 0) {
                        const time = (node.startBeat - firstNote.startBeat) / beatSpan;
                        interpolated = startVal + (endVal - startVal) * time;
                    }
                    setValue(clipId, node.id, Math.round(interpolated));
                }
            };

            const getEndVal = (clientY: number): number => {
                const containerRect = container.getBoundingClientRect();
                const ry = clientY - containerRect.top;
                return Math.round((1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)))) * 127);
            };

            // Apply initial ramp from anchor position
            applyRamp(getEndVal(event.clientY));

            const onMove = ({ clientY }: LanePointerPosition): void => {
                applyRamp(getEndVal(clientY));
            };

            const onCommit = (): void => {
                const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
                const changes: { id: string; oldVal: number; newVal: number }[] = [];
                for (const [id, oldVal] of initialValues.entries()) {
                    const finalNote = stateNotes.find((node) => node.id === id);
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
                            for (const context of changes) {
                                setValue(clipId, context.id, context.oldVal);
                            }
                        },
                        () => {
                            for (const context of changes) {
                                setValue(clipId, context.id, context.newVal);
                            }
                        }
                    );
                }
            };

            beginDrag({
                pointerId: event.pointerId,
                captureTarget: canvas,
                move: onMove,
                commit: onCommit,
            });
            return;
        }

        // ── A8: Continuous velocity painting (single or drag-through) ─────
        const noteId = hitNote.id;
        const origValues = new Map<string, number>(notes.map((node) => [node.id, getValue(node)]));

        const getVal = (clientY: number): number => {
            const containerRect = container.getBoundingClientRect();
            const ry = clientY - containerRect.top;
            return Math.round((1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)))) * 127);
        };

        setValue(clipId, noteId, getVal(event.clientY));

        const onMove = ({ clientX, clientY }: LanePointerPosition): void => {
            const containerRect = container.getBoundingClientRect();
            const rx = clientX - containerRect.left;
            const value = getVal(clientY);
            // Paint the note currently under the cursor (horizontal movement)
            const noteAtX = hitNoteAtX(rx);
            if (noteAtX) {
                setValue(clipId, noteAtX.id, value);
            }
        };

        const onCommit = (): void => {
            const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
            const changes: { id: string; oldVal: number; newVal: number }[] = [];
            for (const node of stateNotes) {
                const oldVal = origValues.get(node.id);
                if (oldVal !== undefined) {
                    const newVal = getValue(node);
                    if (newVal !== oldVal) {
                        changes.push({ id: node.id, oldVal, newVal });
                    }
                }
            }
            if (changes.length > 0) {
                pushUndoEntry(
                    undoLabel,
                    () => {
                        for (const context of changes) {
                            setValue(clipId, context.id, context.oldVal);
                        }
                    },
                    () => {
                        for (const context of changes) {
                            setValue(clipId, context.id, context.newVal);
                        }
                    }
                );
            }
        };

        beginDrag({
            pointerId: event.pointerId,
            captureTarget: canvas,
            move: onMove,
            commit: onCommit,
        });
    };

    const handleRampDrag = (side: 'left' | 'right', event: PointerEvent<HTMLDivElement>) => {
        if (!clipId || dragSessionRef.current) {
            return;
        }
        const container = containerRef.current;
        if (!container || sortedSelected.length < 2) {
            return;
        }

        event.stopPropagation();
        event.preventDefault();

        const firstNote = sortedSelected[0];
        const lastNote = sortedSelected[sortedSelected.length - 1];
        if (!firstNote || !lastNote) {
            return;
        }

        const h = container.getBoundingClientRect().height;
        const startLeftVal = getValue(firstNote);
        const startRightVal = getValue(lastNote);

        const initialValues = new Map(sortedSelected.map((node) => [node.id, getValue(node)]));

        const captureTarget = event.currentTarget;

        const onMove = ({ clientY }: LanePointerPosition) => {
            const containerRect = container.getBoundingClientRect();
            const ry = clientY - containerRect.top;
            const r = 1 - Math.max(0, Math.min(1, (ry - 2) / (h - 4)));
            const newVal = Math.round(r * 127);

            const currentLeft = side === 'left' ? newVal : startLeftVal;
            const currentRight = side === 'right' ? newVal : startRightVal;

            const beatSpan = lastNote.startBeat - firstNote.startBeat;

            for (const node of sortedSelected) {
                let interpolated = currentLeft;
                if (beatSpan > 0) {
                    const time = (node.startBeat - firstNote.startBeat) / beatSpan;
                    interpolated = currentLeft + (currentRight - currentLeft) * time;
                }
                setValue(clipId, node.id, Math.round(interpolated));
            }
        };

        const onCommit = () => {
            const stateNotes = midiStore.value?.notesByClipId[clipId] ?? [];
            const changes: { id: string; oldVal: number; newVal: number }[] = [];

            for (const [id, oldVal] of initialValues.entries()) {
                const finalNote = stateNotes.find((node) => node.id === id);
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
                                changes.map((context) => ({ noteId: context.id, velocity: context.oldVal }))
                            );
                        } else {
                            for (const context of changes) {
                                setValue(clipId, context.id, context.oldVal);
                            }
                        }
                    },
                    () => {
                        if (setValues) {
                            setValues(
                                clipId,
                                changes.map((context) => ({ noteId: context.id, velocity: context.newVal }))
                            );
                        } else {
                            for (const context of changes) {
                                setValue(clipId, context.id, context.newVal);
                            }
                        }
                    }
                );
            }
        };

        beginDrag({
            pointerId: event.pointerId,
            captureTarget,
            move: onMove,
            commit: onCommit,
        });
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
            <canvas
                ref={canvasRef}
                className="cursor-ns-resize touch-none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                onLostPointerCapture={handleDragEnd}
            />
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
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize touch-none transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: leftX + 1, top: getYPercent(leftVal) }}
                        onPointerDown={(event) => handleRampDrag('left', event)}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        onLostPointerCapture={handleDragEnd}
                    />
                    <div
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize touch-none transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: rightX + 1, top: getYPercent(rightVal) }}
                        onPointerDown={(event) => handleRampDrag('right', event)}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        onLostPointerCapture={handleDragEnd}
                    />
                </>
            ) : null}
        </div>
    );
};
