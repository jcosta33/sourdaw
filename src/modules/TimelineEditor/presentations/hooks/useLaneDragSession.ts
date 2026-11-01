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
import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, useEffect } from 'react';

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

const isUnmodifiedEscape = (event: KeyboardEvent): boolean =>
    event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;

/**
 * Take the armed gesture out of the ref and drop its Escape ownership — the drag mark and the
 * Escape listener — in one step, so whichever exit runs first ends the gesture and every later
 * one finds nothing. Null when no gesture is armed.
 */
const takeArmedDrag = (armedRef: RefObject<ArmedLaneDrag | null>): ArmedLaneDrag | null => {
    const armed = armedRef.current;
    if (!armed) {
        return null;
    }
    armedRef.current = null;
    armed.disarm();
    return armed;
};

/**
 * End the in-flight gesture exactly once by committing it. What guarantees that is the clear
 * happening *at all*, synchronously, before this returns: the trailing `pointerup`/`lostpointercapture`
 * the browser still delivers then finds no gesture to finalize. Placing the clear ahead of `commit()` is cheap
 * insurance against a future re-entrant commit only — `releasePointerCapture()` merely nulls the
 * pending capture target, and `lostpointercapture` fires from the process-pending-pointer-capture
 * steps before the next pointer event rather than synchronously here (Blink matches the spec), so
 * no current path re-enters and no test can red the ordering. See M16 on PR #1262.
 */
const commitLaneDrag = (armedRef: RefObject<ArmedLaneDrag | null>): void => {
    const armed = takeArmedDrag(armedRef);
    if (!armed) {
        return;
    }
    const { session } = armed;
    try {
        session.captureTarget.releasePointerCapture(session.pointerId);
    } catch {
        // The browser releases capture itself on pointercancel and on element removal.
    }
    session.commit();
};

/**
 * Escape cancels while the button is still down, so the press is not over: its pointerup and the
 * click after it are still to come. Capture is kept for them. The browser releases it implicitly
 * right after the pointer's own pointerup or pointercancel (Pointer Events, "Implicit release of
 * pointer capture"), and until then the trailing events stay on the capture target, where no
 * session remains to commit. Releasing early instead would send the release's click to the
 * nearest common ancestor of the press and release targets (UI Events click targeting) — over
 * empty lane, the lane container, whose click handler adds a point.
 *
 * The press's one click is swallowed as well, because capture can still be lost before the
 * release (the pressed handle unmounting). The swallower is a window capture-phase listener so
 * it runs ahead of every lane. It ends after its click, after the pointerup's task (the click is
 * dispatched in that same task), on the pointer's pointercancel (no click follows one), on the
 * next pointerdown, when the window loses focus or the tab hides (the release may then happen
 * outside the page, so no pointerup arrives), and when the lane unmounts, so it can never eat a
 * later, real click such as a keyboard-activated button.
 */
const swallowCancelledPressClick = (pointerId: number): (() => void) => {
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const end = (): void => {
        clearTimeout(releaseTimer);
        window.removeEventListener('click', swallowClick, true);
        window.removeEventListener('pointerup', handlePointerUp, true);
        window.removeEventListener('pointercancel', handlePointerCancel, true);
        window.removeEventListener('pointerdown', end, true);
    };

    const swallowClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        end();
    };

    const handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) {
            return;
        }
        releaseTimer = setTimeout(end, 0);
    };

    const handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) {
            return;
        }
        end();
    };

    window.addEventListener('click', swallowClick, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('pointerdown', end, true);
    return end;
};

/** End the pending cancelled-press swallower, if any. */
const endCancelledPress = (endRef: RefObject<(() => void) | null>): void => {
    endRef.current?.();
    endRef.current = null;
};

/**
 * The move/end handlers a lane spreads onto the element that outlives its drag handles.
 * All four events bubble, so binding them one level up costs nothing and keeps the gesture
 * alive when the pressed handle unmounts mid-drag.
 */
type LaneDragHandlers = {
    onPointerMove: (event: ReactPointerEvent<Element>) => void;
    onPointerUp: (event: ReactPointerEvent<Element>) => void;
    onPointerCancel: (event: ReactPointerEvent<Element>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<Element>) => void;
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
    const endCancelledPressRef = useRef<(() => void) | null>(null);

    const cancelArmedDrag = (): void => {
        const armed = takeArmedDrag(armedDragRef);
        if (!armed) {
            return;
        }
        endCancelledPress(endCancelledPressRef);
        endCancelledPressRef.current = swallowCancelledPressClick(armed.session.pointerId);
        armed.session.cancel();
    };

    useEffect(() => {
        const handleWindowBlur = (): void => {
            commitLaneDrag(armedDragRef);
            endCancelledPress(endCancelledPressRef);
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                commitLaneDrag(armedDragRef);
                endCancelledPress(endCancelledPressRef);
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
            commitLaneDrag(armedDragRef);
            endCancelledPress(endCancelledPressRef);
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
            // A held Escape's auto-repeat is ignored, as the global shortcut layer ignores it, so
            // a drag begun while the key is still down survives.
            if (event.repeat || !isUnmodifiedEscape(event)) {
                return;
            }
            cancelArmedDrag();
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

    const handleDragMove = (event: ReactPointerEvent<Element>): void => {
        const session = armedDragRef.current?.session;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        session.move({ clientX: event.clientX, clientY: event.clientY });
    };

    const handleDragEnd = (event: ReactPointerEvent<Element>): void => {
        const session = armedDragRef.current?.session;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        commitLaneDrag(armedDragRef);
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
