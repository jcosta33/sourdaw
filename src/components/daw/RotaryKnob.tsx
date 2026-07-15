import { type MouseEvent, type ReactElement, type PointerEvent, useEffect, useLayoutEffect, useRef } from 'react';

import { useStore } from '#/infra/store/useStore';
import { midiLearnStore, type MidiLearnState } from '#/modules/MIDI/stores';
import { startMidiLearn } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

const defaultMidiLearnState: MidiLearnState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

type Tone =
    | 'neutral'
    | 'amber'
    | 'cyan'
    | 'peach'
    | 'lavender'
    | 'mint'
    | 'steel'
    | 'danger'
    | 'rose'
    | 'indigo'
    | 'sage'
    | 'copper';

const TONE_COLORS: Record<Tone, string> = {
    neutral: 'rgba(255, 255, 255, 0.5)',
    amber: 'rgba(196, 170, 95, 0.62)',
    cyan: 'rgba(127, 184, 196, 0.62)',
    peach: 'rgba(201, 160, 122, 0.62)',
    lavender: 'rgba(168, 155, 196, 0.62)',
    mint: 'rgba(125, 184, 160, 0.62)',
    steel: 'rgba(106, 138, 168, 0.62)',
    danger: 'rgba(192, 96, 96, 0.62)',
    rose: 'rgba(192, 96, 112, 0.62)',
    indigo: 'rgba(74, 96, 160, 0.62)',
    sage: 'rgba(138, 168, 138, 0.62)',
    copper: 'rgba(184, 136, 104, 0.62)',
};

type ModulationHalo = {
    id: string;
    /** Fraction of full sweep (-1 to +1) representing modulation depth */
    amount: number;
    /** CSS color string for this modulation source */
    color: string;
};

export type GestureAuthority = {
    acquire: () => string | number;
    isCurrent: (token: string | number) => boolean;
};

type RotaryKnobProps = {
    value: number;
    onChange: (val: number, isTransient?: boolean) => void;
    min?: number;
    max?: number;
    step?: number;
    fineStep?: number;
    defaultValue?: number;
    bipolar?: boolean;
    scale?: 'linear' | 'log';
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
    /** Label rendered below the knob. When set, the component expands its min-width to prevent label overlap. */
    label?: string;
    paramId?: string;
    targetType?: 'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam';
    trackId?: string;
    deviceId?: string;
    /** Color tone for the value arc */
    tone?: Tone;
    /** Stable semantic owner token; changing it cancels an active drag without committing it. */
    gestureOwner?: string | number;
    /** Optional synchronous authority for controls that serialize competing gestures. */
    gestureAuthority?: GestureAuthority;
    /**
     * R-C1: Active modulation sources displayed as colored conic-gradient halo arcs.
     * Each entry represents one modulator connected to this parameter.
     */
    modulations?: ModulationHalo[];
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
    tone = 'cyan',
    modulations,
    scale = 'linear',
    gestureOwner,
    gestureAuthority,
}: RotaryKnobProps): ReactElement => {
    const midiLearnState = useStore<MidiLearnState>(midiLearnStore, defaultMidiLearnState);
    const isLearningThis = Boolean(
        midiLearnState.isLearning &&
        midiLearnState.learningTarget &&
        midiLearnState.learningTarget.paramId === paramId &&
        paramId !== undefined
    );
    const isMapped = Boolean(midiLearnState.mappings.some((message) => message.paramId === paramId));
    // Derive sensible defaults from range when not explicitly provided
    const step = stepProp ?? Math.max(0.001, (max - min) / 200);
    const fineStep = fineStepProp ?? step / 10;
    const draggingRef = useRef(false);
    const activePointerIdRef = useRef<number | null>(null);
    const startY = useRef(0);
    const startValue = useRef(value);
    const currentValue = useRef(value);
    const rootRef = useRef<HTMLDivElement>(null);
    const px = SIZES[size];
    const onChangeRef = useRef(onChange);
    const gestureOwnerAtStartRef = useRef<string | number | undefined>(gestureOwner);
    const gestureAuthorityRef = useRef<GestureAuthority | undefined>(gestureAuthority);
    const finalizeDragRef = useRef<(pointerId?: number) => boolean>(() => false);

    const clearDragState = (): void => {
        draggingRef.current = false;
        activePointerIdRef.current = null;
        rootRef.current?.removeAttribute('data-dragging');
    };

    const ownsGesture = (): boolean => {
        const token = gestureOwnerAtStartRef.current;
        const authority = gestureAuthorityRef.current;
        if (authority) {
            return token !== undefined && authority.isCurrent(token);
        }
        return Object.is(token, gestureOwner);
    };

    useLayoutEffect(() => {
        onChangeRef.current = onChange;
        gestureAuthorityRef.current = gestureAuthority;

        if (draggingRef.current && !Object.is(gestureOwnerAtStartRef.current, gestureOwner)) {
            clearDragState();
        }

        finalizeDragRef.current = (pointerId?: number): boolean => {
            if (!draggingRef.current) {
                return false;
            }
            if (pointerId !== undefined && activePointerIdRef.current !== pointerId) {
                return false;
            }

            const ownsCurrentGesture = ownsGesture();
            clearDragState();
            if (ownsCurrentGesture && !Object.is(currentValue.current, startValue.current)) {
                onChangeRef.current(currentValue.current, false);
            }
            return true;
        };
    });

    useEffect(() => {
        return () => {
            finalizeDragRef.current();
        };
    }, []);

    const clamp = (value1: number): number => {
        let clamped = Math.max(min, Math.min(max, value1));
        if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.01) {
            clamped = defaultValue;
        }
        return clamped;
    };

    const resetToDefault = () => {
        if (Object.is(value, defaultValue)) {
            return;
        }
        onChange(defaultValue, false);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (activePointerIdRef.current !== null || event.button !== 0) {
            return;
        }
        if (event.altKey) {
            resetToDefault();
            return;
        }
        const gestureToken = gestureAuthorityRef.current?.acquire() ?? gestureOwner;
        if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        activePointerIdRef.current = event.pointerId;
        draggingRef.current = true;
        gestureOwnerAtStartRef.current = gestureToken;
        startY.current = event.clientY;
        startValue.current = value;
        currentValue.current = value;
        rootRef.current?.setAttribute('data-dragging', '');
    };

    const normalized =
        scale === 'log' && min > 0
            ? Math.max(0, Math.min(1, (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))))
            : Math.max(0, Math.min(1, (value - min) / (max - min)));

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current || activePointerIdRef.current !== event.pointerId) {
            return;
        }
        if (!ownsGesture()) {
            clearDragState();
            return;
        }
        const deltaY = startY.current - event.clientY;
        const sweepPx = 150;

        let raw: number;
        if (scale === 'log' && min > 0) {
            const startNorm = (Math.log(startValue.current) - Math.log(min)) / (Math.log(max) - Math.log(min));
            let sensitivityNorm = 1 / sweepPx;
            if (event.shiftKey) {
                sensitivityNorm *= 0.1;
            }
            const newNorm = Math.max(0, Math.min(1, startNorm + deltaY * sensitivityNorm));
            raw = min * Math.exp(newNorm * (Math.log(max) - Math.log(min)));
        } else {
            let sensitivity = (max - min) / sweepPx;
            if (event.shiftKey) {
                sensitivity *= 0.1;
            }
            raw = startValue.current + deltaY * sensitivity;
        }

        const currentStep = event.shiftKey ? fineStep : step;
        const quantized = Math.round(raw / currentStep) * currentStep;
        const clamped = clamp(quantized);
        if (Object.is(clamped, currentValue.current)) {
            return;
        }
        currentValue.current = clamped;
        onChangeRef.current(clamped, true);
    };

    const commitDrag = (event: PointerEvent<HTMLDivElement>): boolean => finalizeDragRef.current(event.pointerId);

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (!commitDrag(event)) {
            return;
        }
        if (typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleDoubleClick = () => {
        resetToDefault();
    };

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        if (paramId && targetType) {
            event.preventDefault();
            startMidiLearn({
                targetType,
                paramId,
                trackId: trackId ?? 'global',
                deviceId,
            });
        }
    };

    const rotation = -135 + normalized * 270;

    // Conic arc gradient for the value ring
    const arcAngleDeg = normalized * 270;
    const arcColor = TONE_COLORS[tone];
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
            onPointerCancel={commitDrag}
            onLostPointerCapture={commitDrag}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
        >
            {isLearningThis ? (
                <div className="absolute inset-[-4px] rounded-full border border-dashed border-[var(--color-accent-lavender)] animate-pulse pointer-events-none z-10" />
            ) : null}
            {isMapped && !isLearningThis ? (
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

                {/* R-C1: Modulation halo arcs — one layer per connected modulator */}
                {modulations?.map((mod) => {
                    const amountDeg = mod.amount * 270;
                    let haloBg: string;
                    if (amountDeg >= 0) {
                        const lo = arcAngleDeg;
                        const hi = Math.min(lo + amountDeg, 270);
                        haloBg = `conic-gradient(from 225deg, transparent 0deg, transparent ${lo}deg, ${mod.color} ${lo}deg, ${mod.color} ${hi}deg, transparent ${hi}deg)`;
                    } else {
                        const hi = arcAngleDeg;
                        const lo = Math.max(0, hi + amountDeg);
                        haloBg = `conic-gradient(from 225deg, transparent 0deg, transparent ${lo}deg, ${mod.color} ${lo}deg, ${mod.color} ${hi}deg, transparent ${hi}deg)`;
                    }
                    return (
                        <div
                            key={mod.id}
                            className="absolute inset-0 rounded-full pointer-events-none"
                            style={{
                                background: haloBg,
                                mask: 'radial-gradient(circle, transparent 55%, black 57%)',
                                WebkitMask: 'radial-gradient(circle, transparent 55%, black 57%)',
                                opacity: 0.8,
                            }}
                        />
                    );
                })}

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
