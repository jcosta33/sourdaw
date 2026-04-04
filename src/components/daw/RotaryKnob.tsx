import { type ReactElement, type PointerEvent, useRef, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiLearnStore } from '#/modules/MIDI/stores/midiLearnStore';
import { startMidiLearn } from '#/modules/MIDI/useCases/midiLearn';

type RotaryKnobProps = {
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
    /** Label rendered below the knob. When set, the component expands its min-width to prevent label overlap. */
    label?: string;
    paramId?: string;
    targetType?: 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';
    trackId?: string;
    deviceId?: string;
};

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
    label,
    paramId,
    targetType = 'fermenterGlobalParam', // Default to fermenterGlobalParam for now
    trackId,
    deviceId,
}: RotaryKnobProps): ReactElement => {
    const midiLearnState = useSyncExternalStore(
        (cb) => midiLearnStore.subscribe(cb),
        () => midiLearnStore.value
    );
    const isLearningThis = Boolean(
        midiLearnState?.isLearning &&
        midiLearnState.learningTarget &&
        midiLearnState.learningTarget.paramId === paramId &&
        paramId !== undefined
    );
    const isMapped = Boolean(midiLearnState?.mappings.some((m) => m.paramId === paramId));
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

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = true;
        startY.current = event.clientY;
        startValue.current = value;
        rootRef.current?.setAttribute('data-dragging', '');
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        const deltaY = startY.current - event.clientY;
        const sweepPx = 150;
        let sensitivity = (max - min) / sweepPx;
        if (event.shiftKey) {
            sensitivity *= 0.1;
        }
        const raw = startValue.current + deltaY * sensitivity;
        const currentStep = event.shiftKey ? fineStep : step;
        const quantized = Math.round(raw / currentStep) * currentStep;
        onChange(clamp(quantized));
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        rootRef.current?.removeAttribute('data-dragging');
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        if (paramId && targetType) {
            e.preventDefault();
            startMidiLearn({
                targetType,
                paramId,
                trackId: trackId ?? 'global',
                deviceId,
            });
        }
    };

    // Visual rotation (-135deg to +135deg → 270deg sweep)
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const rotation = -135 + normalized * 270;

    // Conic arc gradient for the value ring
    const arcAngleDeg = normalized * 270;
    const arcColor = 'rgba(127, 184, 196, 0.62)';
    const arcBg = bipolar
        ? buildBipolarArc(normalized, arcColor)
        : `conic-gradient(from 225deg, ${arcColor} 0deg, ${arcColor} ${arcAngleDeg}deg, transparent ${arcAngleDeg}deg, transparent 270deg, transparent 270deg)`;

    return (
        <div
            ref={rootRef}
            className={cn(
                'group/knob relative flex flex-col items-center select-none touch-none cursor-ns-resize',
                label && 'min-w-fit',
                className
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
        >
            {isLearningThis ? (
                <div className="absolute inset-[-4px] rounded-full border border-dashed border-[var(--color-accent-lavender)] animate-pulse pointer-events-none z-10" />
            ) : null}
            {(isMapped && !isLearningThis) ? (
                <div className="absolute top-0 right-0 size-2 rounded-full bg-[var(--color-accent-lavender)]/80 pointer-events-none z-10" />
            ) : null}
            {/* Outer bezel (well) */}
            <div
                className={cn(
                    'relative rounded-full bg-bg-panelInset flex items-center justify-center p-[2px] channel-inset'
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
                        'relative h-full w-full rounded-full border border-border-soft transition-[filter,box-shadow] group-hover/knob:brightness-[1.03]'
                    )}
                    style={{
                        background:
                            'radial-gradient(ellipse 60% 40% at 45% 32%, rgba(255,255,255,0.18) 0%, transparent 65%), radial-gradient(circle at 50% 40%, #474747 0%, #323232 36%, #1e1e1e 78%, #1a1a1a 100%)',
                        boxShadow:
                            'inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.28), 0 1px 3px rgba(0,0,0,0.6)',
                        transform: `rotate(${rotation}deg)`,
                    }}
                >
                    {/* Position indicator line */}
                    <div
                        className="absolute left-1/2 -translate-x-1/2 rounded-full"
                        style={{
                            top: '12%',
                            width: px >= 72 ? 3 : 2,
                            height: px >= 72 ? '25%' : '28%',
                            background: 'linear-gradient(180deg, #ccc 0%, #888 100%)',
                            boxShadow: '0 0 2px rgba(255,255,255,0.15)',
                        }}
                    />
                </div>
            </div>
            {label ? (
                <span className="mt-0.5 whitespace-nowrap text-[7px] leading-none tracking-[0.12em] text-text-tertiary uppercase">
                    {label}
                </span>
            ) : null}
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
