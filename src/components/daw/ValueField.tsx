import { type ReactElement, type PointerEvent, useState, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';

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
}: ValueFieldProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const startY = useRef(0);
    const startValue = useRef(value);

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        } // Only left click
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
        startY.current = event.clientY;
        startValue.current = value;
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!isDragging) {
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

        onChange(newValue);
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handleDoubleClick = () => {
        if (onReset) {
            onReset();
        }
    };

    return (
        <div className={cn('flex flex-col items-center gap-0.5 group', className)}>
            {label ? (
                <span className="text-[9px] uppercase tracking-wider text-text-disabled font-semibold mb-0.5">
                    {label}
                </span>
            ) : null}
            <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                className={cn(
                    'flex items-center justify-center font-mono cursor-ns-resize select-none',
                    'transition-colors duration-fast rounded-micro px-1.5 py-0.5',
                    'bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] border border-border-hairline',
                    isDragging
                        ? 'text-accent-cyan ring-1 ring-border-focus'
                        : 'text-text-primary hover:text-accent-cyan hover:border-border-soft',
                    'text-[10px]'
                )}
            >
                {Math.round(value * 100) / 100}
                {unit}
            </div>
        </div>
    );
};
