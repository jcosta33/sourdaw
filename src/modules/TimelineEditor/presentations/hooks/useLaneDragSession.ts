/**
 * useLaneDragSession — the pointer-capture drag machinery shared by every automation lane
 * in the piano roll (`NotePropertyLane`, `CCLane`, `PitchBendLane`).
 *
 * The hook owns *how* a gesture lives and dies; each lane owns *what* the gesture does.
 * A lane calls `beginDrag` once per drag path it has — `NotePropertyLane` has three
 * (canvas paint, shift+drag ramp, the two ramp end-handles), `CCLane` and `PitchBendLane`
 * have one each — and the hook is identical for all of them because everything that varies
 * travels inside the session's own `move` / `commit` / `cancel` closures. There is no lane
 * parameter and no per-lane option, so a one-path caller carries no configuration it does not use.
 *
 * An armed gesture is also an Escape owner, like every other drag in the app: it marks itself
 * with `beginDragGesture()` so the global Escape chain and the virtual keyboard yield the key,
 * and unmodified Escape abandons it through the session's `cancel`.
 */
import { type PointerEvent, type RefObject, useRef, useEffect } from 'react';

import { beginDragGesture } from '#/utils/UI/activeDragGesture';

export type LanePointerPosition = {
    clientX: number;
    clientY: number;
};

/**
 * One in-flight drag gesture. The pointer is captured on `captureTarget`, so every
 * subsequent event for `pointerId` is retargeted there by the browser — no window pointer
 * listeners, and a release outside the window still arrives as pointerup/pointercancel.
 */
export type LaneDragSession = {
    pointerId: number;
    captureTarget: Element;
    move: (position: LanePointerPosition) => void;
    /** Keep what the gesture wrote and record it as one undo entry. */
    commit: () => void;
    /**
     * Abandon the gesture: put back every value it wrote since the press, including any write the
     * press itself made, and push no undo entry. Escape runs this instead of `commit`.
     */
    cancel: () => void;
};

/** The armed session plus the teardown that releases what arming took beyond pointer capture. */
type ArmedLaneDrag = {
    session: LaneDragSession;
    disarm: () => void;
};

type LaneDragOutcome = 'commit' | 'cancel';

const isUnmodifiedEscape = (event: KeyboardEvent): boolean =>
    event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;

/**
 * End the in-flight gesture exactly once, by commit or by cancel. What guarantees that is the clear
 * happening *at all*, synchronously, before this returns: the trailing `pointerup`/`lostpointercapture`
 * the browser still delivers — after an Escape cancel too — then finds no gesture to commit, and the
 * drag mark and Escape listener go with the same clear. Placing the clear ahead of `commit()` is cheap
 * insurance against a future re-entrant commit only — `releasePointerCapture()` merely nulls the
 * pending capture target, and `lostpointercapture` fires from the process-pending-pointer-capture
 * steps before the next pointer event rather than synchronously here (Blink matches the spec), so
 * no current path re-enters and no test can red the ordering. See M16 on PR #1262.
 */
const finishLaneDrag = (armedRef: RefObject<ArmedLaneDrag | null>, outcome: LaneDragOutcome): void => {
    const armed = armedRef.current;
    if (!armed) {
        return;
    }
    armedRef.current = null;
    armed.disarm();
    const { session } = armed;
    try {
        session.captureTarget.releasePointerCapture(session.pointerId);
    } catch {
        // The browser releases capture itself on pointercancel and on element removal.
    }
    if (outcome === 'cancel') {
        session.cancel();
        return;
    }
    session.commit();
};

/**
 * The move/end handlers a lane spreads onto the element that outlives its drag handles.
 * All four events bubble, so binding them one level up costs nothing and keeps the gesture
 * alive when the pressed handle unmounts mid-drag.
 */
type LaneDragHandlers = {
    onPointerMove: (event: PointerEvent<Element>) => void;
    onPointerUp: (event: PointerEvent<Element>) => void;
    onPointerCancel: (event: PointerEvent<Element>) => void;
    onLostPointerCapture: (event: PointerEvent<Element>) => void;
};

type UseLaneDragSessionOutput = {
    /** True while a gesture is armed. Lanes reject a fresh `pointerdown` on this. */
    hasActiveDrag: () => boolean;
    /** Arm a gesture. Takes capture first — see the comment on the implementation. */
    beginDrag: (session: LaneDragSession) => void;
    dragHandlers: LaneDragHandlers;
};

export const useLaneDragSession = (): UseLaneDragSessionOutput => {
    const armedDragRef = useRef<ArmedLaneDrag | null>(null);

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finishLaneDrag(armedDragRef, 'commit');
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finishLaneDrag(armedDragRef, 'commit');
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
            finishLaneDrag(armedDragRef, 'commit');
        };
    }, []);

    const hasActiveDrag = (): boolean => {
        return armedDragRef.current !== null;
    };

    /**
     * Capture first, arm second. Both orderings this protects are real:
     *
     * - `NotePropertyLane` writes a value during `pointerdown`, so discovering *after* the write
     *   that the gesture has no owner strands a mutation with no undo entry to commit it.
     * - `CCLane` and `PitchBendLane` write nothing on `pointerdown`, so what the ordering protects
     *   there is the arm — swap these two lines and a `setPointerCapture` that throws leaves the
     *   ref set with no capture, and each lane's live-session guard then refuses every later press:
     *   the lane is dead until it remounts. The drag mark and the Escape listener follow the arm
     *   for the same reason: a refused capture must leave no stale Escape owner behind.
     *
     * The Escape listener is a window bubble listener added at arm time, as `startMouseDrag` does.
     * The global shortcut layer registers its window keydown listener at app start, so it runs
     * first and still sees the drag mark; the virtual keyboard listens in the capture phase, ahead
     * of both. Clearing the mark from a capture listener would let either one take the key.
     */
    const beginDrag = (session: LaneDragSession): void => {
        session.captureTarget.setPointerCapture(session.pointerId);
        const endDragGesture = beginDragGesture();
        const handleEscape = (event: KeyboardEvent): void => {
            if (!isUnmodifiedEscape(event)) {
                return;
            }
            finishLaneDrag(armedDragRef, 'cancel');
        };
        window.addEventListener('keydown', handleEscape);
        armedDragRef.current = {
            session,
            disarm: () => {
                window.removeEventListener('keydown', handleEscape);
                endDragGesture();
            },
        };
    };

    const handleDragMove = (event: PointerEvent<Element>): void => {
        const session = armedDragRef.current?.session;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        session.move({ clientX: event.clientX, clientY: event.clientY });
    };

    const handleDragEnd = (event: PointerEvent<Element>): void => {
        const session = armedDragRef.current?.session;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        finishLaneDrag(armedDragRef, 'commit');
    };

    return {
        hasActiveDrag,
        beginDrag,
        dragHandlers: {
            onPointerMove: handleDragMove,
            onPointerUp: handleDragEnd,
            onPointerCancel: handleDragEnd,
            onLostPointerCapture: handleDragEnd,
        },
    };
};
