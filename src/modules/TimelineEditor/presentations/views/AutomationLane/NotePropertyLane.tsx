/**
 * Note-property lane — the velocity/probability/pressure/slide bar chart that
 * sits under the piano roll.
 *
 * ## Scope is the selection's clips, not just the primary clip
 *
 * A selection can span every clip the piano roll has open, and this lane shows
 * and edits exactly what that selection touches: the primary clip's notes
 * always, plus every opened clip that owns a selected note. Each note is
 * addressed through its own clip — every `setValue`/`setValues` call and every
 * undo closure routes by owner clip, the same ownership rule the piano roll's
 * keyboard paths use (`buildNoteOwnershipMaps` in `usePianoRollInteractions`).
 * A single-clip selection therefore behaves exactly as a primary-only lane
 * always did. Opened clips the selection does not touch stay out of the lane;
 * their bars would be uneditable-in-spirit decoration and would crowd the hit
 * test.
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

/** A bar in the lane: the note plus the clip that owns it. */
type LaneNoteEntry = { note: MidiNote; clipId: string };

/**
 * Opened clips the selection reaches into. Only those join the lane's scope
 * (the primary clip is always in), so a selection confined to the primary clip
 * leaves the lane exactly as narrow as it was before multi-clip editing.
 */
const selectionTouchedClipIds = (
    openedClipNotes: Record<string, MidiNote[]> | undefined,
    selectedNoteIds: Set<string>
): Set<string> => {
    const touched = new Set<string>();
    for (const [clipId, clipNotes] of Object.entries(openedClipNotes ?? {})) {
        if (clipNotes.some((node) => selectedNoteIds.has(node.id))) {
            touched.add(clipId);
        }
    }
    return touched;
};

/**
 * The lane's whole note feed: the primary clip's notes plus the selected
 * clips' notes, each carrying its owner. Every consumer below — the paint
 * loop, the hit test, the ramp anchors, the undo diffs — walks this one feed,
 * so none of them can drift back into a single-clip scope.
 */
const buildLaneNotes = (
    clipId: string | null,
    notesByClipId: Record<string, MidiNote[]>,
    openedClipNotes: Record<string, MidiNote[]> | undefined,
    selectedNoteIds: Set<string>
): LaneNoteEntry[] => {
    const entries: LaneNoteEntry[] = [];
    if (clipId) {
        for (const note of notesByClipId[clipId] ?? []) {
            entries.push({ note, clipId });
        }
    }
    for (const ownerClipId of selectionTouchedClipIds(openedClipNotes, selectedNoteIds)) {
        for (const note of openedClipNotes?.[ownerClipId] ?? []) {
            entries.push({ note, clipId: ownerClipId });
        }
    }
    return entries;
};

/** Undo diff row: what one note's value was before a gesture and is after. */
type UndoChange = { clipId: string; id: string; oldVal: number; newVal: number };

/** The value of every note in a gesture's scope when it starts, keyed by note id. */
const captureInitialValues = (
    entries: LaneNoteEntry[],
    getValue: (note: MidiNote) => number
): Map<string, { clipId: string; value: number }> =>
    new Map(entries.map((entry) => [entry.note.id, { clipId: entry.clipId, value: getValue(entry.note) }]));

/**
 * Diff the live store against a gesture's captured start, reading each note
 * from its own clip. Undo keeps the keyboard velocity path's shape: one entry
 * per gesture, every note addressed through its owner clip.
 */
const collectUndoChanges = (
    initialValues: Map<string, { clipId: string; value: number }>,
    getValue: (note: MidiNote) => number
): UndoChange[] => {
    const changes: UndoChange[] = [];
    for (const [id, initial] of initialValues.entries()) {
        const finalNote = (midiStore.value?.notesByClipId[initial.clipId] ?? []).find((node) => node.id === id);
        if (finalNote) {
            const newVal = getValue(finalNote);
            if (newVal !== initial.value) {
                changes.push({ clipId: initial.clipId, id, oldVal: initial.value, newVal });
            }
        }
    }
    return changes;
};

/**
 * Restore one side of a gesture's diff. With a `setValues` the diff is
 * batched per clip — one store update per clip keeps each clip's edit atomic.
 */
const replayChanges = (
    changes: UndoChange[],
    side: 'oldVal' | 'newVal',
    setValue: (clipId: string, noteId: string, value: number) => void,
    setValues?: (clipId: string, updates: { noteId: string; velocity: number }[]) => void
): void => {
    if (!setValues) {
        for (const change of changes) {
            setValue(change.clipId, change.id, change[side]);
        }
        return;
    }
    const updatesByClip = new Map<string, { noteId: string; velocity: number }[]>();
    for (const change of changes) {
        const updates = updatesByClip.get(change.clipId) ?? [];
        updates.push({ noteId: change.id, velocity: change[side] });
        updatesByClip.set(change.clipId, updates);
    }
    for (const [ownerClipId, updates] of updatesByClip) {
        setValues(ownerClipId, updates);
    }
};

type NotePropertyLaneProps = {
    clipId: string | null;
    /**
     * Track of the primary clip. Kept in the shared lane-props shape every
     * property lane wrapper passes; this lane itself resolves colors per clip
     * across all tracks, because a selection-touched clip may live on any
     * track.
     */
    trackId: string;
    selectedNoteIds: Set<string>;
    /**
     * Notes of the clips the piano roll has open alongside the primary clip,
     * keyed by clip id (the primary clip is excluded). The lane draws and edits
     * the notes of whichever of these clips the selection reaches into.
     */
    openedClipNotes?: Record<string, MidiNote[]>;
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
    selectedNoteIds,
    openedClipNotes,
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

    const laneNotes = buildLaneNotes(clipId, midiState.notesByClipId, openedClipNotes, selectedNoteIds);

    // Every clip in scope resolves its own color, the same lookup the piano
    // roll's renderer uses for opened clips — a secondary clip's bars must not
    // borrow the primary clip's color, or the lane would lie about ownership.
    const colorForClip = (ownerClipId: string): string => {
        for (const track of trackState.tracks) {
            const clip = track.clips.find((context) => context.id === ownerClipId);
            if (clip) {
                return clip.color || track.color || 'oklch(0.45 0.06 250)';
            }
        }
        return 'oklch(0.45 0.06 250)';
    };

    const selectedEntries = laneNotes.filter((entry) => selectedNoteIds.has(entry.note.id));
    const sortedSelected = [...selectedEntries].sort((alpha, beta) => alpha.note.startBeat - beta.note.startBeat);

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

            if (laneNotes.length === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.font = '10px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(`No notes — add MIDI to edit ${label.toLowerCase()}`, viewportWidth / 2, h / 2 + 4);
                return;
            }

            // From here the lane draws in content coordinates, the same space
            // the hit test and the ramp handles use.
            ctx.setTransform(dpr, 0, 0, dpr, -scrollDevicePx, 0);

            for (const { note, clipId: ownerClipId } of laneNotes) {
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

                const clipColor = colorForClip(ownerClipId);
                const noteColor = isSelected ? brightenColor(clipColor, 0.22) : clipColor;
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
    }, [laneNotes, selectedNoteIds, beatWidth, colorForClip, getValue, label, scrollRef]);

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

    const hitNoteAtX = (mx: number): LaneNoteEntry | null => {
        // Walk in reverse paint order: the render loop above draws `laneNotes`
        // in array order, so the last one painted — the topmost when notes
        // overlap — is the highest index here. Forward iteration returned the
        // first (bottommost) overlap instead of the one the user can see.
        for (let index = laneNotes.length - 1; index >= 0; index--) {
            const entry = laneNotes[index]!;
            const nx = entry.note.startBeat * beatWidth;
            const barW = Math.max(3, entry.note.duration * beatWidth - 2);
            if (mx >= nx + 1 && mx <= nx + 1 + barW) {
                return entry;
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
            const firstNote = sortedSelected[0]!.note;
            const lastNote = sortedSelected[sortedSelected.length - 1]!.note;
            const initialValues = captureInitialValues(sortedSelected, getValue);
            const startVal = initialValues.get(firstNote.id)?.value ?? getValue(firstNote);
            const beatSpan = lastNote.startBeat - firstNote.startBeat;

            const applyRamp = (endVal: number): void => {
                for (const { note: node, clipId: ownerClipId } of sortedSelected) {
                    let interpolated = startVal;
                    if (beatSpan > 0) {
                        const time = (node.startBeat - firstNote.startBeat) / beatSpan;
                        interpolated = startVal + (endVal - startVal) * time;
                    }
                    setValue(ownerClipId, node.id, Math.round(interpolated));
                }
            };

            const onMove = (position: LanePointerPosition): void => {
                applyRamp(valueAt(position));
            };

            const onCommit = (): void => {
                const changes = collectUndoChanges(initialValues, getValue);
                if (changes.length > 0) {
                    pushUndoEntry(
                        `${undoLabel} ramp`,
                        () => {
                            for (const change of changes) {
                                setValue(change.clipId, change.id, change.oldVal);
                            }
                        },
                        () => {
                            for (const change of changes) {
                                setValue(change.clipId, change.id, change.newVal);
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
        const pressedEntry = hitNote;
        const origValues = captureInitialValues(laneNotes, getValue);

        const onMove = (position: LanePointerPosition): void => {
            const point = toLanePoint(position.clientX, position.clientY);
            // Paint the note currently under the cursor (horizontal movement)
            const entryAtX = hitNoteAtX(point.x);
            if (entryAtX) {
                setValue(entryAtX.clipId, entryAtX.note.id, valueFromLaneY(point.y, h));
            }
        };

        const onCommit = (): void => {
            const changes = collectUndoChanges(origValues, getValue);
            if (changes.length > 0) {
                pushUndoEntry(
                    undoLabel,
                    () => {
                        for (const change of changes) {
                            setValue(change.clipId, change.id, change.oldVal);
                        }
                    },
                    () => {
                        for (const change of changes) {
                            setValue(change.clipId, change.id, change.newVal);
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
        setValue(pressedEntry.clipId, pressedEntry.note.id, valueAt(event));
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
        const startLeftVal = getValue(firstNote.note);
        const startRightVal = getValue(lastNote.note);

        const initialValues = captureInitialValues(sortedSelected, getValue);

        const captureTarget = event.currentTarget;

        const onMove = ({ clientX, clientY }: LanePointerPosition) => {
            const newVal = valueFromLaneY(toLanePoint(clientX, clientY).y, h);

            const currentLeft = side === 'left' ? newVal : startLeftVal;
            const currentRight = side === 'right' ? newVal : startRightVal;

            const beatSpan = lastNote.note.startBeat - firstNote.note.startBeat;

            for (const { note: node, clipId: ownerClipId } of sortedSelected) {
                let interpolated = currentLeft;
                if (beatSpan > 0) {
                    const time = (node.startBeat - firstNote.note.startBeat) / beatSpan;
                    interpolated = currentLeft + (currentRight - currentLeft) * time;
                }
                setValue(ownerClipId, node.id, Math.round(interpolated));
            }
        };

        const onCommit = () => {
            const changes = collectUndoChanges(initialValues, getValue);

            if (changes.length > 0) {
                pushUndoEntry(
                    `${undoLabel} ramp`,
                    () => {
                        replayChanges(changes, 'oldVal', setValue, setValues);
                    },
                    () => {
                        replayChanges(changes, 'newVal', setValue, setValues);
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
        ? firstSelected.note.startBeat * beatWidth + Math.max(3, firstSelected.note.duration * beatWidth - 2) / 2
        : 0;
    const rightX = lastSelected
        ? lastSelected.note.startBeat * beatWidth + Math.max(3, lastSelected.note.duration * beatWidth - 2) / 2
        : 0;

    const leftVal = firstSelected ? getValue(firstSelected.note) : 0;
    const rightVal = lastSelected ? getValue(lastSelected.note) : 0;

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
