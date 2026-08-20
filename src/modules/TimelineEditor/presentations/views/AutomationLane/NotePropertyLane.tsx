/**
 * Note-property lane — the velocity/probability/pressure/slide bar chart that
 * sits under the piano roll.
 *
 * ## The canvas covers the viewport, not the clip
 *
 * The backing store spans the visible slice of the scroll container this lane
 * is laid out inside, and every bar is drawn translated by that container's
 * `scrollLeft`, so canvas x `0` is the beat at the left edge of the viewport.
 * The element is `position: sticky` inside a wrapper that carries the full
 * content width (`PianoRoll.tsx`, `ClipView/AutomationLane.tsx`), so CSS layout
 * owns the scroll extent and the canvas never has to — the same split
 * `usePianoRollRenderer` uses for the roll above.
 *
 * Nothing here may size the backing store from the clip. A canvas dimension is
 * finite, so `beats * beatWidth * devicePixelRatio` had to fit inside it, which
 * made the reachable beat count inversely proportional to zoom by construction:
 * at the toolbar's 400% the browser's limit landed around beat 102 on a 2x
 * display and beat 68 on a 3x one, and any budget on that product could only
 * pick which of the two to sacrifice.
 */
import { type ReactElement, type PointerEvent, type RefObject, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { resolveToken } from '#/utils/UI/resolveToken';

import { colorWithAlpha, brightenColor } from '../../helpers/oklchColor';
import { useLaneDragSession, type LanePointerPosition } from '../../hooks/useLaneDragSession';

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

/**
 * Lane-local y → a 0–127 property value, clamped to the drawable band (the bars
 * keep 2px of padding at the top and bottom of the lane).
 */
const valueFromLaneY = (y: number, height: number): number =>
    Math.round((1 - Math.max(0, Math.min(1, (y - 2) / (height - 4)))) * 127);

type NotePropertyLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    /**
     * The horizontally scrolling wrapper this lane is laid out inside. Its
     * `clientWidth` is the width the backing store is sized to and its
     * `scrollLeft` is both the drawing origin and the offset every pointer
     * position is mapped through.
     */
    scrollRef: RefObject<HTMLElement | null>;
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
    scrollRef,
    getValue,
    setValue,
    setValues,
    label,
    undoLabel,
}: NotePropertyLaneProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { hasActiveDrag, beginDrag, dragHandlers } = useLaneDragSession();

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

    // Passive, not layout: React attaches a host ref only after the layout
    // effects of everything below it have run, so `scrollRef` — owned by an
    // ancestor — is still null during this component's layout phase. A passive
    // effect runs after the whole commit, when it is attached.
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const scrollEl = scrollRef.current;
        if (!canvas || !container) {
            return undefined;
        }

        const draw = (): void => {
            const dpr = window.devicePixelRatio || 1;
            const h = container.getBoundingClientRect().height;
            // Viewport, not content extent. The wrapper around this lane
            // carries the clip's width in CSS and owns the scroll; the backing
            // store only ever covers what is on screen.
            const viewportWidth = scrollEl?.clientWidth ?? 0;
            if (viewportWidth <= 0) {
                // Not laid out yet, or the panel is collapsed to nothing. There
                // is no visible slice to draw, and sizing the backing store off
                // a bogus measurement is how the picture ends up blank.
                return;
            }

            canvas.width = Math.round(viewportWidth * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = `${viewportWidth}px`;
            canvas.style.height = `${h}px`;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }

            // Snapped to whole device pixels so the bars do not shimmer a
            // fraction of a pixel while scrolling.
            const scrollDevicePx = Math.max(0, Math.round((scrollEl?.scrollLeft ?? 0) * dpr));
            const scrollPx = scrollDevicePx / dpr;

            // Background first, in canvas-local space.
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
            ctx.fillRect(0, 0, viewportWidth, h);

            if (notes.length === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(`No notes — add MIDI to edit ${label.toLowerCase()}`, viewportWidth / 2, h / 2 + 4);
                return;
            }

            // From here the lane draws in content coordinates, the same space
            // the hit test and the ramp handles use.
            ctx.setTransform(dpr, 0, 0, dpr, -scrollDevicePx, 0);

            for (const note of notes) {
                const x = note.startBeat * beatWidth;
                const barW = Math.max(3, note.duration * beatWidth - 2);
                // Cull against the drawn slice. A long clip's bars are mostly
                // off-viewport at any useful zoom, and this loop runs on every
                // frame of a scroll.
                if (x + 1 + barW < scrollPx || x + 1 > scrollPx + viewportWidth) {
                    continue;
                }
                const val = getValue(note);
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
        };

        draw();

        // The drawn window moves with the scroll offset and its width with the
        // panel, so both have to repaint — neither goes through React.
        let observer: ResizeObserver | null = null;
        if (scrollEl) {
            scrollEl.addEventListener('scroll', draw, { passive: true });
            if (typeof ResizeObserver !== 'undefined') {
                observer = new ResizeObserver(draw);
                observer.observe(scrollEl);
            }
        }
        return () => {
            scrollEl?.removeEventListener('scroll', draw);
            observer?.disconnect();
        };
    }, [notes, selectedNoteIds, beatWidth, clipColor, selectedColor, getValue, label, scrollRef]);

    /**
     * The one place a pointer becomes a lane coordinate. Every gesture below
     * goes through it, and none of them may re-derive this inline.
     *
     * `x` is a content x — the same space the bars are drawn in and the hit
     * test walks. Getting there needs the scroll offset added back, because the
     * canvas is pinned to the viewport by `position: sticky`: its
     * `getBoundingClientRect().left` is the left edge of the visible slice, not
     * of the clip. While the canvas scrolled natively `clientX - rect.left` was
     * already a content x, so this is exactly the correction that a handler
     * left on the old formula would silently skip, by the width of the scroll.
     *
     * `y` is measured from the lane root, which is what the value math and the
     * bar heights are expressed against.
     */
    const toLanePoint = (clientX: number, clientY: number): { x: number; y: number } => {
        const canvasLeft = canvasRef.current?.getBoundingClientRect().left ?? 0;
        const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
        return {
            x: clientX - canvasLeft + (scrollRef.current?.scrollLeft ?? 0),
            y: clientY - containerTop,
        };
    };

    const hitNoteAtX = (mx: number): (typeof notes)[0] | null => {
        // Walk in reverse paint order: the render loop above draws `notes` in
        // array order, so the last one painted — the topmost when notes
        // overlap — is the highest index here. Forward iteration returned the
        // first (bottommost) overlap instead of the one the user can see.
        for (let index = notes.length - 1; index >= 0; index--) {
            const note = notes[index]!;
            const nx = note.startBeat * beatWidth;
            const barW = Math.max(3, note.duration * beatWidth - 2);
            if (mx >= nx + 1 && mx <= nx + 1 + barW) {
                return note;
            }
        }
        return null;
    };

    const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
        // Primary contact only — the right button opens the piano roll's context menu.
        if (!clipId || hasActiveDrag() || event.button !== 0) {
            return;
        }
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        const h = container.getBoundingClientRect().height;
        const hitNote = hitNoteAtX(toLanePoint(event.clientX, event.clientY).x);

        if (!hitNote) {
            return;
        }

        /** Property value under a pointer, whatever element it was captured on. */
        const valueAt = ({ clientX, clientY }: LanePointerPosition): number =>
            valueFromLaneY(toLanePoint(clientX, clientY).y, h);

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

            const onMove = (position: LanePointerPosition): void => {
                applyRamp(valueAt(position));
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
            // Apply initial ramp from anchor position — only once the gesture has an owner.
            applyRamp(valueAt(event));
            return;
        }

        // ── A8: Continuous velocity painting (single or drag-through) ─────
        const noteId = hitNote.id;
        const origValues = new Map<string, number>(notes.map((node) => [node.id, getValue(node)]));

        const onMove = (position: LanePointerPosition): void => {
            const point = toLanePoint(position.clientX, position.clientY);
            // Paint the note currently under the cursor (horizontal movement)
            const noteAtX = hitNoteAtX(point.x);
            if (noteAtX) {
                setValue(clipId, noteAtX.id, valueFromLaneY(point.y, h));
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
        setValue(clipId, noteId, valueAt(event));
    };

    const handleRampDrag = (side: 'left' | 'right', event: PointerEvent<HTMLDivElement>) => {
        // Primary contact only — the right button opens the piano roll's context menu.
        if (!clipId || hasActiveDrag() || event.button !== 0) {
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

        const onMove = ({ clientX, clientY }: LanePointerPosition) => {
            const newVal = valueFromLaneY(toLanePoint(clientX, clientY).y, h);

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

    // The move/end handlers live on the container, not on the pressed element: the ramp handles
    // unmount as soon as the selection drops below two notes, and a gesture must not die with them.
    // `touchAction: 'none'` keeps the browser's own pan/zoom from claiming the stroke on touch.
    return (
        <div
            ref={containerRef}
            className="relative h-full w-full"
            style={{ touchAction: 'none' }}
            role="group"
            aria-label={`${label} lane`}
            {...dragHandlers}
        >
            {/*
             * The backing store covers only the visible slice (see the block
             * comment at the top of this file), so the canvas stays pinned to
             * the left edge of the scrollport while the container around it —
             * which carries the clip's full width — scrolls past. The ramp
             * overlay below is plain DOM in content coordinates and keeps
             * scrolling natively.
             */}
            <canvas
                ref={canvasRef}
                className="sticky left-0 block cursor-ns-resize"
                style={{ touchAction: 'none' }}
                onPointerDown={handleCanvasPointerDown}
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
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: leftX + 1, top: getYPercent(leftVal), touchAction: 'none' }}
                        onPointerDown={(event) => handleRampDrag('left', event)}
                    />
                    <div
                        className="absolute w-3 h-3 bg-white border border-black rounded-full cursor-ns-resize transform -translate-x-1/2 -translate-y-1/2 shadow-sm z-10"
                        style={{ left: rightX + 1, top: getYPercent(rightVal), touchAction: 'none' }}
                        onPointerDown={(event) => handleRampDrag('right', event)}
                    />
                </>
            ) : null}
        </div>
    );
};
