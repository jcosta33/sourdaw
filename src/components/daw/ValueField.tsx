import { type ReactElement, type PointerEvent, useRef, useState } from 'react';

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
    onReset?: () => void;
    className?: string;
    /**
     * When true the field is a readout only: dragging and double-click reset do
     * nothing. Use it where the underlying value exists but cannot be written
     * from here, rather than leaving a control that quietly writes elsewhere.
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
 * ValueField / ScrubField
 * Drag to scrub vertically/horizontally, double-click to reset,
 * Shift-drag for fine tuning.
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
        newValue = Math.round(newValue / currentStep) * currentStep;

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

    let displayValue = value;
    if (pendingValue !== null) {
        displayValue = pendingValue;
    }

    return (
        <div className={cn('flex flex-col items-center gap-0.5 group', className)}>
            {label ? (
                <span className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-disabled">
                    {label}
                </span>
            ) : null}
            <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                aria-readonly={readOnly}
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
                {Math.round(displayValue * 100) / 100}
                {unit}
            </div>
        </div>
    );
};
