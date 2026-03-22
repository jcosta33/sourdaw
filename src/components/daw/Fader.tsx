import { type ReactElement, useState, useRef, useCallback } from 'react';
import { cn } from '#/helpers/Styles/cn';

interface FaderProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    defaultValue?: number;
    bipolar?: boolean;
    height?: number;
    showScale?: boolean;
    className?: string;
}

/** dB marks for the fader scale */
const DB_MARKS = [6, 0, -6, -12, -24, -48] as const;

/**
 * Fader
 * Vertical mixer fader with metallic cap, groove track, and dB scale.
 * Drag cap to slide, Shift for fine mode, double-click to reset.
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
    showScale = false,
    className,
}: FaderProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const startY = useRef(0);
    const startValue = useRef(value);

    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));

    const clampAndSnap = useCallback(
        (v: number) => {
            let clamped = Math.max(min, Math.min(max, v));
            if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.05) {
                clamped = defaultValue;
            }
            return clamped;
        },
        [min, max, defaultValue, bipolar]
    );

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !trackRef.current) {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);

        const capEl = e.currentTarget.querySelector('[data-role="fader-cap"]');
        const isCapClick = capEl?.contains(e.target as Node);

        if (!isCapClick) {
            const rect = trackRef.current.getBoundingClientRect();
            const percent = 1 - (e.clientY - rect.top) / rect.height;
            const newValue = clampAndSnap(min + percent * (max - min));
            onChange(newValue);
            startValue.current = newValue;
            startY.current = e.clientY;
        } else {
            startValue.current = value;
            startY.current = e.clientY;
        }
    };

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return;
            }
            const deltaY = startY.current - e.clientY;
            const currentStep = e.shiftKey ? fineStep : step;
            const pxPerUnit = height / (max - min);
            let sensitivity = 1 / pxPerUnit;
            if (e.shiftKey) {
                sensitivity *= 0.1;
            }
            let newValue = startValue.current + deltaY * sensitivity;
            newValue = Math.round(newValue / currentStep) * currentStep;
            onChange(clampAndSnap(newValue));
        },
        [isDragging, step, fineStep, max, min, height, clampAndSnap, onChange]
    );

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    const capBottomPct = normalized * 100;
    const unityPct = Math.max(0, Math.min(100, ((defaultValue - min) / (max - min)) * 100));

    return (
        <div
            className={cn('relative flex items-center select-none group', className)}
            style={{ height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
        >
            {/* dB scale marks (left side) */}
            {showScale && (
                <div className="absolute -left-6 top-0 bottom-0 w-5 flex flex-col justify-between pointer-events-none">
                    {DB_MARKS.map((db) => {
                        const pct = ((db - min) / (max - min)) * 100;
                        return (
                            <span
                                key={db}
                                className={cn(
                                    'absolute right-0 text-[8px] font-mono leading-none',
                                    db === 0 ? 'text-text-primary' : 'text-text-disabled'
                                )}
                                style={{ bottom: `${pct}%`, transform: 'translateY(50%)' }}
                            >
                                {db > 0 ? `+${db}` : String(db)}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Track groove */}
            <div
                ref={trackRef}
                className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[5px] rounded-full overflow-hidden"
                style={{
                    background: '#0A0A0A',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
                }}
            >
                {/* Unity gain line */}
                <div
                    className="absolute w-full h-px z-0"
                    style={{
                        bottom: `${unityPct}%`,
                        background: 'rgba(255,255,255,0.15)',
                    }}
                />

                {/* Tick marks at the right side for visual reference */}
                {showScale &&
                    DB_MARKS.map((db) => {
                        const pct = ((db - min) / (max - min)) * 100;
                        return (
                            <div
                                key={db}
                                className="absolute right-0 w-[2px] h-px bg-white/10"
                                style={{ bottom: `${pct}%` }}
                            />
                        );
                    })}
            </div>

            {/* Fader cap */}
            <div
                data-role="fader-cap"
                className={cn(
                    'absolute w-8 h-10 left-1/2 -ml-4 rounded-sm z-10',
                    'transition-all duration-instant',
                    isDragging ? 'cursor-grabbing' : 'cursor-grab',
                    'flex flex-col items-center justify-center gap-[2px]'
                )}
                style={{
                    bottom: `calc(${capBottomPct}% - 20px)`,
                    background: isDragging
                        ? 'linear-gradient(180deg, #4a4a4a 0%, #333 30%, #2a2a2a 50%, #222 70%, #1a1a1a 100%)'
                        : 'linear-gradient(180deg, #555 0%, #3a3a3a 30%, #333 50%, #2a2a2a 70%, #222 100%)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderTopColor: isDragging ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.12)',
                    borderBottomColor: 'rgba(0,0,0,0.4)',
                    boxShadow: isDragging
                        ? 'inset 0 2px 4px rgba(0,0,0,0.6)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 3px rgba(0,0,0,0.6)',
                }}
            >
                {/* Center groove marks */}
                <div className={cn('w-4 h-px', isDragging ? 'bg-accent-cyan' : 'bg-white/10')} />
                <div className="w-5 h-px bg-white/15" />
                <div className={cn('w-4 h-px', isDragging ? 'bg-accent-cyan' : 'bg-white/10')} />
            </div>
        </div>
    );
};
