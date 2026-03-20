import { type ReactElement, useState, useRef, useCallback } from 'react';
import { cn } from '#/helpers/Styles/cn';

export interface RotaryKnobProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    defaultValue?: number;
    bipolar?: boolean; // if true, centers the visual arc
    size?: number; // px diameter
    className?: string;
}

/**
 * RotaryKnob
 * Skeuomorphic detented dial. Dark satin metal cap with a luminescent line.
 * Vertical drag sets value. Shift for fine control.
 */
export const RotaryKnob = ({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    fineStep = 0.1,
    defaultValue = 50,
    bipolar = false,
    size = 32,
    className
}: RotaryKnobProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const startY = useRef(0);
    const startValue = useRef(value);

    const clampAndSnap = useCallback((v: number) => {
        let clamped = Math.max(min, Math.min(max, v));
        // Soft magnetism to default only if bipolar
        if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.05) {
            clamped = defaultValue;
        }
        return clamped;
    }, [min, max, defaultValue, bipolar]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
        startY.current = e.clientY;
        startValue.current = value;
    };

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        
        const deltaY = startY.current - e.clientY;
        const currentStep = e.shiftKey ? fineStep : step;
        
        // Scalar sensitivity: about 150px drag for full sweep generally
        const sweepPx = 150;
        let sensitivity = (max - min) / sweepPx;
        if (e.shiftKey) sensitivity *= 0.1;

        let newValue = startValue.current + (deltaY * sensitivity);
        newValue = Math.round(newValue / currentStep) * currentStep;
        
        onChange(clampAndSnap(newValue));
    }, [isDragging, step, fineStep, max, min, clampAndSnap, onChange]);

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    // Visual rotation (-135deg to +135deg is a 270deg sweep)
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const rotation = -135 + (normalized * 270);

    return (
        <div 
            className={cn('relative flex flex-col items-center select-none group touch-none cursor-ns-resize', className)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
        >
            {/* Outer well / bezel */}
            <div 
                className={cn(
                    'relative rounded-full bg-bg-panelInset shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] flex items-center justify-center p-[2px]',
                    isDragging && 'ring-1 ring-border-focus'
                )}
                style={{ width: size, height: size }}
            >
                {/* Knob Cap (satin metal) */}
                <div 
                    className={cn(
                        'w-full h-full rounded-full bg-surface-raised border border-border-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.5)] relative',
                        isDragging && 'shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] bg-bg-panel'
                    )}
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    {/* Tiny luminous line indicator */}
                    <div 
                        className={cn(
                            'absolute top-[10%] left-1/2 -translate-x-1/2 rounded-full',
                            isDragging ? 'bg-accent-cyan shadow-[0_0_4px_var(--color-accent-cyan)]' : 'bg-text-secondary',
                            'w-[2px] h-[30%]'
                        )}
                    />
                </div>
            </div>
        </div>
    );
};
