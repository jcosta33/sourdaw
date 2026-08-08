/**
 * useLaneDragSession — the pointer-capture drag machinery shared by every automation lane
 * in the piano roll (`NotePropertyLane`, `CCLane`, `PitchBendLane`).
 *
 * The hook owns *how* a gesture lives and dies; each lane owns *what* the gesture does.
 * A lane calls `beginDrag` once per drag path it has — `NotePropertyLane` has three
 * (canvas paint, shift+drag ramp, the two ramp end-handles), `CCLane` and `PitchBendLane`
 * have one each — and the hook is identical for all of them because everything that varies
 * travels inside the session's own `move` / `commit` closures. There is no lane parameter
 * and no per-lane option, so a one-path caller carries no configuration it does not use.
 */
import { type PointerEvent, type RefObject, useRef, useEffect } from 'react';

export type LanePointerPosition = {
    clientX: number;
    clientY: number;
};

/**
 * One in-flight drag gesture. The pointer is captured on `captureTarget`, so every
 * subsequent event for `pointerId` is retargeted there by the browser — no window
 * listeners, and a release outside the window still arrives as pointerup/pointercancel.
 */
export type LaneDragSession = {
    pointerId: number;
    captureTarget: Element;
    move: (position: LanePointerPosition) => void;
    commit: () => void;
};

/**
 * End the in-flight gesture exactly once. What guarantees that is the clear happening *at all*,
 * synchronously, before this returns: the trailing `pointerup`/`lostpointercapture` the browser
 * still delivers then finds no gesture to finalize. Placing the clear ahead of `commit()` is cheap
 * insurance against a future re-entrant commit only — `releasePointerCapture()` merely nulls the
 * pending capture target, and `lostpointercapture` fires from the process-pending-pointer-capture
 * steps before the next pointer event rather than synchronously here (Blink matches the spec), so
 * no current path re-enters and no test can red the ordering. See M16 on PR #1262.
 */
const finalizeLaneDrag = (sessionRef: RefObject<LaneDragSession | null>): void => {
    const session = sessionRef.current;
    if (!session) {
        return;
    }
    sessionRef.current = null;
    try {
        session.captureTarget.releasePointerCapture(session.pointerId);
    } catch {
        // The browser releases capture itself on pointercancel and on element removal.
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
    const dragSessionRef = useRef<LaneDragSession | null>(null);

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finalizeLaneDrag(dragSessionRef);
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finalizeLaneDrag(dragSessionRef);
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
            finalizeLaneDrag(dragSessionRef);
        };
    }, []);

    const hasActiveDrag = (): boolean => {
        return dragSessionRef.current !== null;
    };

    /**
     * Capture first, arm second. Both orderings this protects are real:
     *
     * - `NotePropertyLane` writes a value during `pointerdown`, so discovering *after* the write
     *   that the gesture has no owner strands a mutation with no undo entry to commit it.
     * - `CCLane` and `PitchBendLane` write nothing on `pointerdown`, so what the ordering protects
     *   there is the arm — swap these two lines and a `setPointerCapture` that throws leaves the
     *   ref set with no capture, and each lane's live-session guard then refuses every later press:
     *   the lane is dead until it remounts.
     */
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
        finalizeLaneDrag(dragSessionRef);
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
