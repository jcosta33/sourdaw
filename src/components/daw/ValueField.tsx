import { type ReactElement, type PointerEvent, type KeyboardEvent, useRef, useState } from 'react';

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
    const pendingValueRef = useRef<number | null>(null);
    const startY = useRef(0);
    const startValue = useRef(value);

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (readOnly) {
            return;
        }
        if (event.button !== 0) {
            return;
        } // Only left click
        if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        draggingRef.current = true;
        setIsDragging(true);
        startY.current = event.clientY;
        startValue.current = value;
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
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
        const wasDragging = draggingRef.current;
        draggingRef.current = false;
        setIsDragging(false);
        if (typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const committed = pendingValueRef.current;
        pendingValueRef.current = null;
        setPendingValue(null);
        if (wasDragging && commitMode === 'release' && committed !== null) {
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
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                className={cn(
                    'daw-inset-surface flex items-center justify-center rounded-micro px-1.5 py-0.5 font-mono tabular-nums select-none',
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
