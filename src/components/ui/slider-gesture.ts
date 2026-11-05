import {
    type ComponentProps,
    type FocusEvent,
    type KeyboardEvent,
    type PointerEvent,
    type RefObject,
    useEffect,
    useRef,
} from 'react';

import { type Slider as SliderPrimitive } from 'radix-ui';

type SliderRootProps = ComponentProps<typeof SliderPrimitive.Root>;

type SliderValueHandler = (value: number[]) => void;

type SliderGestureProps = Pick<
    SliderRootProps,
    | 'value'
    | 'defaultValue'
    | 'min'
    | 'onValueChange'
    | 'onValueCommit'
    | 'onPointerDown'
    | 'onPointerCancel'
    | 'onLostPointerCapture'
    | 'onBlur'
    | 'onKeyDownCapture'
>;

type PendingGesture = {
    value: number[];
    commit: SliderValueHandler;
};

type GestureState = {
    /** The last change reported and not yet committed, with the commit of the render that reported it. */
    pending: PendingGesture | null;
    /** The pointer whose capture the slider holds; only its cancel or capture loss ends the gesture. */
    pointerId: number | null;
    /** The value last committed, so Radix reporting or committing it again adds nothing. */
    settled: string | null;
    /** The value the slider held when the pointer gesture began, or at its last commit. */
    start: string | null;
    /** The value last reported, which an uncontrolled slider holds. */
    reported: number[] | null;
};

// The keys Radix turns into a committed step (`onHomeKeyDown`, `onEndKeyDown`, `onStepKeyDown`).
const STEP_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const createGestureState = (): GestureState => ({
    pending: null,
    pointerId: null,
    settled: null,
    start: null,
    reported: null,
});

/** A committed value is both the one already written and where the next gesture starts. */
const recordCommit = (state: GestureState, committed: string): void => {
    state.settled = committed;
    state.start = committed;
};

const settleGesture = (state: GestureState): void => {
    const pending = state.pending;
    if (pending === null) {
        return;
    }
    state.pending = null;
    const settled = String(pending.value);
    // A gesture left where it began changed nothing, as Radix's own slide end judges it.
    if (settled === state.start) {
        return;
    }
    recordCommit(state, settled);
    pending.commit(pending.value);
};

/** Settles the gesture when the window loses focus, the tab hides, or the slider unmounts. */
const useSettleWhenPageOrSliderGoes = (stateRef: RefObject<GestureState>, enabled: boolean): void => {
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const state = stateRef.current;
        const settle = (): void => settleGesture(state);
        const settleWhenHidden = (): void => {
            if (document.visibilityState === 'hidden') {
                settle();
            }
        };
        window.addEventListener('blur', settle);
        document.addEventListener('visibilitychange', settleWhenHidden);
        return () => {
            window.removeEventListener('blur', settle);
            document.removeEventListener('visibilitychange', settleWhenHidden);
            settle();
        };
    }, [stateRef, enabled]);
};

/**
 * The completion law of every Slider gesture: a gesture that reported a change
 * through `onValueChange` ends in exactly one `onValueCommit` carrying its last
 * value, whatever ends it.
 *
 * Radix commits only on a pointerup that still holds capture after the value
 * moved, and on a keyboard step. Every other ending is settled here at the
 * value the gesture was left on: pointercancel, capture lost without a
 * pointerup, the window losing focus, the tab hiding, focus leaving the
 * slider, or the slider unmounting. A gesture left on the value it started
 * from commits nothing on any route. An abandoned gesture commits through the
 * handler of the render that reported its last change, so a surface that
 * swaps its target mid-drag still writes the level to the target it previewed.
 */
export function useSliderGesture({
    value: controlledValue,
    defaultValue,
    min = 0,
    onValueChange,
    onValueCommit,
    onPointerDown,
    onPointerCancel,
    onLostPointerCapture,
    onBlur,
    onKeyDownCapture,
}: SliderGestureProps) {
    const stateRef = useRef<GestureState>(createGestureState());
    useSettleWhenPageOrSliderGoes(stateRef, onValueCommit !== undefined);

    // What Radix holds as `values`: the controlled value, else its own state,
    // which starts at `defaultValue` (Radix defaults it to `[min]`) and follows each report.
    const currentValue = (state: GestureState): number[] => controlledValue ?? state.reported ?? defaultValue ?? [min];

    const handleValueChange = (value: number[]): void => {
        const state = stateRef.current;
        state.reported = value;
        // Radix reports a keyboard step only after committing it.
        if (state.pending === null && state.settled === String(value)) {
            return;
        }
        state.settled = null;
        if (onValueCommit) {
            state.pending = { value, commit: onValueCommit };
        }
        onValueChange?.(value);
    };

    const handleValueCommit = (value: number[]): void => {
        const state = stateRef.current;
        const pending = state.pending;
        const committed = String(value);
        state.pending = null;
        // A pointerup after the gesture was already settled, at the same value.
        if (pending === null && state.settled === committed) {
            return;
        }
        // A keyboard step commits before Radix reports it: preview first, as a pointer edit does.
        if (pending === null || String(pending.value) !== committed) {
            onValueChange?.(value);
        }
        recordCommit(state, committed);
        onValueCommit?.(value);
    };

    /** A typed value or a reset is reported and committed in one step. */
    const commitValue = (value: number[]): void => {
        const state = stateRef.current;
        state.pending = null;
        state.reported = value;
        recordCommit(state, String(value));
        onValueChange?.(value);
        onValueCommit?.(value);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        onPointerDown?.(event);
        // Radix starts no slide for a pointerdown a caller prevented.
        if (event.defaultPrevented) {
            return;
        }
        const state = stateRef.current;
        settleGesture(state);
        state.settled = null;
        state.start = String(currentValue(state));
        state.pointerId = event.pointerId;
    };

    const handlePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
        const state = stateRef.current;
        if (state.pointerId !== event.pointerId) {
            return;
        }
        state.pointerId = null;
        settleGesture(state);
    };

    const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
        onKeyDownCapture?.(event);
        if (STEP_KEYS.has(event.key)) {
            stateRef.current.settled = null;
        }
    };

    const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
        onBlur?.(event);
        if (!event.currentTarget.contains(event.relatedTarget)) {
            settleGesture(stateRef.current);
        }
    };

    return {
        commitValue,
        rootProps: {
            onValueChange: handleValueChange,
            onValueCommit: handleValueCommit,
            onPointerDown: handlePointerDown,
            onPointerCancel: (event: PointerEvent<HTMLDivElement>): void => {
                onPointerCancel?.(event);
                handlePointerEnd(event);
            },
            onLostPointerCapture: (event: PointerEvent<HTMLDivElement>): void => {
                onLostPointerCapture?.(event);
                handlePointerEnd(event);
            },
            onBlur: handleBlur,
            onKeyDownCapture: handleKeyDownCapture,
        },
    };
}
