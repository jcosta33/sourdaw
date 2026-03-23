import { type ReactElement, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';

interface RotaryKnobProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    defaultValue?: number;
    bipolar?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
}

const SIZES = { sm: 24, md: 32, lg: 40, xl: 72 } as const;

/**
 * RotaryKnob
 * Skeuomorphic metallic dome with conic value arc.
 * Vertical drag sets value. Shift for fine control. Double-click resets.
 *
 * Performance: dragging state is tracked via refs, not React state,
 * so pointer-move never triggers re-renders on its own — only `onChange` does.
 */
export const RotaryKnob = ({
    value,
    onChange,
    min = 0,
    max = 100,
    step: stepProp,
    fineStep: fineStepProp,
    defaultValue = 50,
    bipolar = false,
    size = 'md',
    className,
}: RotaryKnobProps): ReactElement => {
    // Derive sensible defaults from range when not explicitly provided
    const step = stepProp ?? Math.max(0.001, (max - min) / 200);
    const fineStep = fineStepProp ?? step / 10;
    const draggingRef = useRef(false);
    const startY = useRef(0);
    const startValue = useRef(value);
    const rootRef = useRef<HTMLDivElement>(null);
    const px = SIZES[size];

    const clamp = (v: number): number => {
        let clamped = Math.max(min, Math.min(max, v));
        if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.01) {
            clamped = defaultValue;
        }
        return clamped;
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        startY.current = e.clientY;
        startValue.current = value;
        rootRef.current?.setAttribute('data-dragging', '');
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        const deltaY = startY.current - e.clientY;
        const sweepPx = 150;
        let sensitivity = (max - min) / sweepPx;
        if (e.shiftKey) {
            sensitivity *= 0.1;
        }
        const raw = startValue.current + deltaY * sensitivity;
        const currentStep = e.shiftKey ? fineStep : step;
        const quantized = Math.round(raw / currentStep) * currentStep;
        onChange(clamp(quantized));
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        rootRef.current?.removeAttribute('data-dragging');
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    // Visual rotation (-135deg to +135deg → 270deg sweep)
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const rotation = -135 + normalized * 270;

    // Conic arc gradient for the value ring
    const arcAngleDeg = normalized * 270;
    const arcColor = 'rgba(127, 184, 196, 0.7)';
    const arcBg = bipolar
        ? buildBipolarArc(normalized, arcColor)
        : `conic-gradient(from 225deg, ${arcColor} 0deg, ${arcColor} ${arcAngleDeg}deg, transparent ${arcAngleDeg}deg, transparent 270deg, transparent 270deg)`;

    return (
        <div
            ref={rootRef}
            className={cn(
                'group/knob relative flex flex-col items-center select-none touch-none cursor-ns-resize',
                className,
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
        >
            {/* Outer bezel (well) */}
            <div
                className={cn(
                    'relative rounded-full bg-bg-panelInset flex items-center justify-center p-[2px] channel-inset',
                )}
                style={{ width: px, height: px }}
            >
                {/* Value arc ring */}
                <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{
                        background: arcBg,
                        mask: 'radial-gradient(circle, transparent 55%, black 57%)',
                        WebkitMask: 'radial-gradient(circle, transparent 55%, black 57%)',
                    }}
                />

                {/* Metallic dome cap — no CSS transition on transform for instant response */}
                <div
                    className={cn(
                        'w-full h-full rounded-full relative border border-border-soft',
                    )}
                    style={{
                        background:
                            'radial-gradient(ellipse 60% 40% at 50% 35%, rgba(255,255,255,0.12) 0%, transparent 70%), radial-gradient(circle at 50% 40%, #444 0%, #2a2a2a 40%, #1a1a1a 100%)',
                        boxShadow:
                            'inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.5)',
                        transform: `rotate(${rotation}deg)`,
                    }}
                >
                    {/* Position indicator line */}
                    <div
                        className="absolute left-1/2 -translate-x-1/2 rounded-full bg-text-secondary"
                        style={{
                            top: '12%',
                            width: px >= 72 ? 3 : 2,
                            height: px >= 72 ? '25%' : '28%',
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

/** Build a bipolar conic arc that fills outward from center (50% = 135deg from start) */
function buildBipolarArc(normalized: number, color: string): string {
    const centerDeg = 135; // 50% of 270° sweep
    const valueDeg = normalized * 270;
    if (valueDeg >= centerDeg) {
        // Fill from center to value (clockwise)
        return `conic-gradient(from 225deg, transparent 0deg, transparent ${centerDeg}deg, ${color} ${centerDeg}deg, ${color} ${valueDeg}deg, transparent ${valueDeg}deg)`;
    }
    // Fill from value to center (counter-clockwise visual)
    return `conic-gradient(from 225deg, transparent 0deg, transparent ${valueDeg}deg, ${color} ${valueDeg}deg, ${color} ${centerDeg}deg, transparent ${centerDeg}deg)`;
}

