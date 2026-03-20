import { type ReactElement, useState, useRef, useCallback } from 'react';
import { cn } from '#/helpers/Styles/cn';

export interface FaderProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    defaultValue?: number;
    bipolar?: boolean; // if true, center detent
    height?: number; // pixel height of the fader throw
    className?: string;
}

/**
 * Fader
 * Vertical slider with smooth DAW interactions.
 * Click track to jump, drag cap to slide, Shift to slow down.
 * Cap visibly depresses when dragged (shadow-elevation-inset).
 */
export const Fader = ({
    value,
    onChange,
    min = -70,
    max = 6,
    step = 0.5,
    fineStep = 0.1,
    defaultValue = 0,
    bipolar = false,
    height = 150,
    className
}: FaderProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const startY = useRef(0);
    const startValue = useRef(value);

    // Calculate normalized value [0, 1] for positioning
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));

    const clampAndSnap = useCallback((v: number) => {
        let clamped = Math.max(min, Math.min(max, v));
        
        // Zero detent magnetism (unity/center) if bipolar
        if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.05) {
            clamped = defaultValue;
        }

        return clamped;
    }, [min, max, defaultValue, bipolar]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !trackRef.current) return;
        
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);

        // Check if we clicked the track vs the cap
        const capEl = e.currentTarget.querySelector('[data-role="fader-cap"]');
        const isCapClick = capEl?.contains(e.target as Node);

        if (!isCapClick) {
            // Jump to position
            const rect = trackRef.current.getBoundingClientRect();
            // invert Y because bottom is min
            const percent = 1 - ((e.clientY - rect.top) / rect.height);
            const newValue = clampAndSnap(min + percent * (max - min));
            onChange(newValue);
            
            // start dragging from here
            startValue.current = newValue;
            startY.current = e.clientY;
        } else {
            startValue.current = value;
            startY.current = e.clientY;
        }
    };

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        
        const deltaY = startY.current - e.clientY;
        const currentStep = e.shiftKey ? fineStep : step;
        
        // Scalar sensitivity relative to fader height
        const pxPerUnit = height / (max - min);
        let sensitivity = 1 / pxPerUnit;
        if (e.shiftKey) sensitivity *= 0.1; // 10x finer 

        let newValue = startValue.current + (deltaY * sensitivity);
        newValue = Math.round(newValue / currentStep) * currentStep;
        
        onChange(clampAndSnap(newValue));
    }, [isDragging, step, fineStep, max, min, height, clampAndSnap, onChange]);

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    // Cap position (bottom up)
    const capBottomPct = normalized * 100;

    return (
        <div 
            className={cn('relative flex flex-col items-center select-none group', className)}
            style={{ height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
        >
            {/* Background Track (Slot) */}
            <div 
                ref={trackRef}
                className="absolute top-0 bottom-0 w-2.5 bg-bg-slot shadow-elevation-inset rounded-full overflow-hidden"
            >
                {/* Track ticks (optional unity line) */}
                <div 
                    className="absolute w-full h-px bg-border-soft opacity-50 z-0" 
                    style={{ bottom: `${Math.max(0, Math.min(100, ((defaultValue - min) / (max - min)) * 100))}%` }} 
                />
            </div>

            {/* Fader Cap */}
            <div
                data-role="fader-cap"
                className={cn(
                    'absolute w-8 h-10 -ml-4 left-1/2 rounded-sm cursor-grab z-10',
                    'transition-all duration-instant',
                    isDragging ? 'shadow-elevation-inset cursor-grabbing drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : 'shadow-elevation-raised',
                    'bg-bg-panel border border-border-soft',
                    'flex flex-col items-center justify-center gap-[2px]'
                )}
                style={{ bottom: `calc(${capBottomPct}% - 20px)` }}
            >
                {/* Grip marks */}
                <div className={cn("w-4 h-px", isDragging ? "bg-accent-cyan" : "bg-border-soft")} />
                <div className="w-5 h-px bg-border-active opacity-50" />
                <div className={cn("w-4 h-px", isDragging ? "bg-accent-cyan" : "bg-border-soft")} />
            </div>
        </div>
    );
};
