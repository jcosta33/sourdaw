import {
    type ReactElement,
    type PointerEvent,
    type KeyboardEvent,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { cn } from '#/utils/Styles/cn';

type ValueFieldProps = {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    unit?: string;
    label?: string;
    /**
     * Accessible name for the widget itself. Prefer it over labelling a wrapper:
     * `aria-label` on a role-less element has no ARIA mapping and is dropped, so
     * a wrapper label leaves the control anonymous to assistive tech.
     */
    ariaLabel?: string;
    onReset?: () => void;
    className?: string;
    /**
     * When true the field is a readout only: dragging, keyboard adjustment and
     * double-click reset do nothing. Use it where the underlying value exists but
     * cannot be written from here, rather than leaving a control that quietly
     * writes elsewhere. Surfaced as `aria-readonly`, and the widget stays
     * focusable — a read-only control is still readable.
     */
    readOnly?: boolean;
    /**
     * `'live'` (default) reports every pointer move. `'release'` shows the
     * scrubbed value locally during the drag and reports it once, on release —
     * for values whose write is a transactional, undoable command, where one
     * history entry per pixel of drag is not a history.
     */
    commitMode?: 'live' | 'release';
};

/**
 * Snap to the nearest step, without the binary-float residue the bare
 * `Math.round(v / step) * step` leaves behind. At `step = 0.1` that arithmetic
 * turns 5.1 into 5.1000000000000005 — the readout rounds it away at two
 * decimals, so the noisy value is invisible right up until it is written into
 * the project.
 */
function snapToStep(value: number, stepSize: number): number {
    if (!(stepSize > 0)) {
        return value;
    }
    return Number((Math.round(value / stepSize) * stepSize).toPrecision(12));
}

/**
 * ValueField / ScrubField
 * Drag to scrub vertically/horizontally, double-click to reset,
 * Shift-drag for fine tuning. Arrow keys / Home / End adjust from the keyboard.
 */
export const ValueField = ({
    value,
    onChange,
    min = -100,
    max = 100,
    step = 1,
    fineStep = 0.1,
    unit = '',
    label,
    ariaLabel,
    onReset,
    className,
    readOnly = false,
    commitMode = 'live',
}: ValueFieldProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const [pendingValue, setPendingValue] = useState<number | null>(null);
    const draggingRef = useRef(false);
    /** The one pointer that owns the in-flight drag, and the only id ever released. */
    const activePointerIdRef = useRef<number | null>(null);
    const pendingValueRef = useRef<number | null>(null);
    const startY = useRef(0);
    const startValue = useRef(value);
    const rootRef = useRef<HTMLDivElement>(null);
    const finalizeDragRef = useRef<() => void>(() => {});

    /**
     * The single exit for a drag that does not end in `pointerup`: `pointercancel`
     * (the OS steals the gesture), capture lost to something else, or a window /
     * tab switch. Mirrors `Fader.finalizeDrag` and `RotaryKnob.clearDragState`.
     *
     * This is not optional alongside the "already owned" guard in
     * `handlePointerDown`. Before that guard, an interrupted drag healed itself by
     * accident, because the next `pointerdown` re-seized `activePointerIdRef`
     * unconditionally. The guard removes that accidental recovery, so without a
     * finalizer a single `pointercancel` would strand the ref and leave the field
     * permanently deaf to the pointer. Guard and finalizer ship together.
     *
     * Unlike `handlePointerUp`, this runs outside any pointer event, so the stored
     * id can be genuinely stale — the pointer may have ended without this element
     * ever seeing its `pointerup`. Hence the `try`/`catch`: releasing an id that is
     * no longer an active pointer is the one case that really does throw.
     */
    const finalizeDrag = (): void => {
        if (!draggingRef.current) {
            return;
        }
        const pointerId = activePointerIdRef.current;
        draggingRef.current = false;
        activePointerIdRef.current = null;
        setIsDragging(false);
        // An interrupted gesture is an abort, not a commit. Dropping the pending
        // value matters most for `commitMode="release"`, where committing it would
        // write a value the user never released on — as an undoable command.
        pendingValueRef.current = null;
        setPendingValue(null);
        if (pointerId === null || !rootRef.current) {
            return;
        }
        try {
            rootRef.current.releasePointerCapture(pointerId);
        } catch {
            // The browser may have already released capture before this runs.
        }
    };

    /**
     * `pointercancel` / `lostpointercapture` arrive for pointers this field does
     * not own: measured in Chromium, a second touch that `handlePointerDown`
     * ignored still gets implicit capture, and still fires `lostpointercapture`
     * here when it lifts. `finalizeDrag` takes no id, so routing those straight to
     * it would let an intruder abort the owner's drag — the very bug the ownership
     * guard exists to prevent, re-entering through the finalizer.
     */
    const handlePointerInterrupt = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== activePointerIdRef.current) {
            return;
        }
        finalizeDrag();
    };

    useLayoutEffect(() => {
        finalizeDragRef.current = finalizeDrag;

        /**
         * A drag already in flight when `readOnly` flips true has to be dropped,
         * not merely stopped from starting. `handlePointerDown`, `handleKeyDown`
         * and `handleDoubleClick` guard the *entry* points, and the move / up
         * handlers work off refs, so without this a field that became read-only
         * mid-gesture kept scrubbing and still committed on release — measured
         * as `onChange(140)` from the lift with `aria-readonly="true"` already
         * on the element.
         *
         * `readOnly` is reachable mid-drag in ordinary use: the playhead
         * crossing into a tempo ramp during playback locks the tempo field under
         * the user's finger.
         *
         * Routing through `finalizeDrag` rather than guarding `handlePointerUp`
         * is the difference between aborting the gesture and silently dropping
         * its result. Guarding the lift alone would leave the readout tracking a
         * finger whose movement can no longer land anywhere, then swallow the
         * commit with no feedback. The finalizer hands the capture back and
         * clears the owner ref, and under `commitMode="release"` it also discards
         * the pending value so the readout reverts — the same treatment
         * `pointercancel`, lost capture, blur and tab-hide already get, and what
         * `RotaryKnob` does when `disabled` flips mid-drag.
         *
         * There is nothing to revert under `commitMode="live"`, the default:
         * `pendingValue` is never set, so the readout falls through to the `value`
         * prop either way. Every move up to the lock was already reported through
         * `onChange` while the field was still writable, and those writes stand —
         * so a controlled parent holds the last live value and the readout keeps
         * showing it (measured at 10 for a drag aborted there) rather than
         * snapping back to where the gesture began. Only the moves after the lock
         * are dropped. That is the intended outcome, not a gap in the abort.
         *
         * After the lock clears the pointer is usually still down, and the field
         * stays inert until a fresh press. Considered and left that way: a
         * cancelled gesture requiring a new press is the universal convention,
         * and every DAW does it. The case is not quite the one the convention was
         * formed around — the trigger here is an app-internal, transient
         * condition the app knows has cleared, not the OS taking the gesture away
         * — but resuming would mean re-seizing capture the browser no longer
         * grants us, re-deriving `startY` from a pointer position we are no
         * longer tracking, and deciding whether the resumed drag is anchored to
         * the old value or the new one. Not worth the machinery for a control
         * whose lock lasts as long as the playhead is inside a ramp.
         *
         * This is why `@eslint-react/set-state-in-effect` now warns on
         * `finalizeDrag`'s two setters (warn-only; CI runs `lint --quiet`). The
         * extra synchronous render is the point in release mode: a layout effect
         * commits the reverted readout before paint, so the locked field never
         * shows a frame of the pending value the aborted gesture had reached.
         * `RotaryKnob` escapes the rule only because it carries its drag state in
         * a DOM attribute rather than in `useState`.
         */
        if (readOnly && draggingRef.current) {
            finalizeDrag();
        }
    });

    // A drag interrupted by a window or tab switch never sees `pointerup`.
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

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (readOnly) {
            return;
        }
        /**
         * A drag already owns this field, so a second finger must not seize it.
         * Without this, the intruder overwrote `activePointerIdRef`, and then the
         * *intruder's* `pointerup` ended the drag and committed, while the real
         * owner's lift was discarded. `RotaryKnob` guards the same way.
         */
        if (activePointerIdRef.current !== null || event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointerIdRef.current = event.pointerId;
        draggingRef.current = true;
        setIsDragging(true);
        startY.current = event.clientY;
        startValue.current = value;
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        if (event.pointerId !== activePointerIdRef.current) {
            return;
        }

        const deltaY = startY.current - event.clientY;
        const currentStep = event.shiftKey ? fineStep : step;

        // Scalar sensitivity
        const sensitivity = event.shiftKey ? 0.05 : 0.5;
        let newValue = startValue.current + deltaY * sensitivity * currentStep;

        // Clamp
        if (min !== undefined) {
            newValue = Math.max(min, newValue);
        }
        if (max !== undefined) {
            newValue = Math.min(max, newValue);
        }

        // Snap to nearest step
        newValue = snapToStep(newValue, currentStep);

        if (commitMode === 'release') {
            pendingValueRef.current = newValue;
            setPendingValue(newValue);
            return;
        }
        onChange(newValue);
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
        /**
         * A drag belongs to the pointer that started it. This used to end on *any*
         * `pointerup`: a second finger lifting, or a press that never became a drag
         * at all (read-only field, non-primary button — both early-return from
         * `handlePointerDown` without capturing), cleared the drag state and asked
         * the element to release a capture it had never taken for that id.
         *
         * Releasing the id we captured rather than `event.pointerId` is what
         * `Fader.finalizeDrag` and `RotaryKnob` already do.
         *
         * This is not about an exception. Measured in Chromium: releasing an id
         * that never captured does *not* throw — `releasePointerCapture` raises
         * `NotFoundError` only for an id that is no longer an active pointer, and a
         * pointer delivering `pointerup` is active by construction. That is also
         * why this handler needs no `try`/`catch`: it only ever releases the id of
         * the event being dispatched. The siblings wrap their release because
         * theirs runs from blur / visibilitychange / `pointercancel` finalizers,
         * outside any pointer event, where the stored id can genuinely be stale.
         */
        if (event.pointerId !== activePointerIdRef.current) {
            return;
        }
        draggingRef.current = false;
        activePointerIdRef.current = null;
        setIsDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);

        const committed = pendingValueRef.current;
        pendingValueRef.current = null;
        setPendingValue(null);
        if (commitMode === 'release' && committed !== null) {
            onChange(committed);
        }
    };

    const handleDoubleClick = () => {
        if (readOnly) {
            return;
        }
        if (onReset) {
            onReset();
        }
    };

    /** Arrow / Home / End adjustment — a `spinbutton` that only responds to a drag is not one. */
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (readOnly || draggingRef.current) {
            return;
        }

        const isIncrement = event.key === 'ArrowUp' || event.key === 'ArrowRight';
        const isDecrement = event.key === 'ArrowDown' || event.key === 'ArrowLeft';
        const isHome = event.key === 'Home';
        const isEnd = event.key === 'End';
        if (!isIncrement && !isDecrement && !isHome && !isEnd) {
            return;
        }

        event.preventDefault();
        const currentStep = event.shiftKey ? fineStep : step;
        let nextValue: number;
        if (isHome) {
            nextValue = min;
        } else if (isEnd) {
            nextValue = max;
        } else {
            const direction = isIncrement ? 1 : -1;
            const stepped = value + direction * currentStep;
            nextValue = snapToStep(Math.max(min, Math.min(max, stepped)), currentStep);
        }

        if (nextValue === value) {
            return;
        }
        onChange(nextValue);
    };

    let displayValue = value;
    if (pendingValue !== null) {
        displayValue = pendingValue;
    }
    const roundedValue = Math.round(displayValue * 100) / 100;

    return (
        <div className={cn('flex flex-col items-center gap-0.5 group', className)}>
            {label ? (
                <span className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-disabled">
                    {label}
                </span>
            ) : null}
            <div
                role="spinbutton"
                tabIndex={0}
                aria-label={ariaLabel ?? label}
                aria-valuenow={roundedValue}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuetext={`${roundedValue}${unit}`}
                aria-readonly={readOnly}
                ref={rootRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerInterrupt}
                onLostPointerCapture={handlePointerInterrupt}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                className={cn(
                    // `touch-none`: without it the browser claims a single-finger
                    // drag as a scroll/pan gesture and answers our capture with
                    // `pointercancel`, so the field cannot be scrubbed by touch at
                    // all — measured as pointerdown → gotpointercapture →
                    // pointercancel, zero `onChange`. `RotaryKnob` already carries
                    // it. `select-none` only stops text selection; it does not
                    // surrender the gesture.
                    'daw-inset-surface flex items-center justify-center rounded-micro px-1.5 py-0.5 font-mono tabular-nums select-none touch-none',
                    'transition-[color,box-shadow,border-color,filter] duration-fast',
                    'cursor-ns-resize',
                    isDragging
                        ? 'text-accent-cyan ring-1 ring-border-focus'
                        : 'text-text-primary hover:text-accent-cyan hover:border-border-soft',
                    readOnly && 'cursor-default text-text-disabled hover:text-text-disabled',
                    'text-[10px]'
                )}
            >
                {roundedValue}
                {unit}
            </div>
        </div>
    );
};
