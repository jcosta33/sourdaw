import {
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type PointerEvent,
    useEffect,
    useLayoutEffect,
    useRef,
} from 'react';

import { cn } from '#/utils/Styles/cn';

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
    /** Finalize the current owner synchronously before installing the new owner. */
    acquire: (finalize: () => void) => string | number;
    isCurrent: (token: string | number) => boolean;
};

export type RotaryKnobProps = {
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
    /** Explicit accessible name for contexts where the visible label is owned by surrounding markup. */
    'aria-label'?: string;
    /**
     * Refuse manual value entry while still showing the current value.
     *
     * Expressed as `aria-disabled` rather than by dropping the element from the
     * tab order: a control is only disabled here when something about the
     * device's current mode makes it inert, and the user has to be able to
     * reach it to read the `title` that says so. Drag, keyboard and
     * double-click-to-default all refuse; nothing else about the control
     * changes, because the value it displays is still real and an automation
     * lane may still be writing it.
     */
    disabled?: boolean;
    /**
     * Hover/description text on the control itself.
     *
     * On the root rather than on an owning wrapper so that a disabled control
     * and the reason it is disabled are the same node: a caller cannot ship one
     * without the other, and a test that finds the control finds the reason.
     */
    title?: string;
    /** Optional presentation state for an owning view to decorate the control. */
    isLearning?: boolean;
    isMapped?: boolean;
    /** Optional context-menu behavior supplied by the owning view. */
    onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
    paramId?: string;
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

export type RotaryKnobComponent = (props: RotaryKnobProps) => ReactElement;

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
    isLearning = false,
    isMapped = false,
    onContextMenu,
    paramId,
    tone = 'cyan',
    modulations,
    scale = 'linear',
    gestureOwner,
    gestureAuthority,
    'aria-label': ariaLabel,
    disabled = false,
    title,
}: RotaryKnobProps): ReactElement => {
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

    const releasePointerCapture = (pointerId: number | null): void => {
        if (pointerId === null || !rootRef.current) {
            return;
        }
        try {
            rootRef.current.releasePointerCapture(pointerId);
        } catch {
            // The browser may have already released capture before this finalizer runs.
        }
    };

    const clearDragState = (): void => {
        const pointerId = activePointerIdRef.current;
        draggingRef.current = false;
        activePointerIdRef.current = null;
        gestureOwnerAtStartRef.current = undefined;
        rootRef.current?.removeAttribute('data-dragging');
        releasePointerCapture(pointerId);
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

        // A drag that is already in flight when `disabled` flips true has to be
        // dropped, not merely stopped from starting. `handlePointerDown` and
        // `handleKeyDown` guard the *entry* points, and `handlePointerMove`
        // holds its own refs, so without this a knob that became inert
        // mid-gesture kept emitting transient writes and still committed on
        // pointer-up — measured at one transient and one commit. Dropping the
        // gesture here rather than finalizing it means the in-flight value is
        // discarded, which is the same treatment an owner change already gets
        // below.
        if (disabled && draggingRef.current) {
            clearDragState();
        }

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

    useLayoutEffect(() => {
        if (!draggingRef.current) {
            currentValue.current = value;
        }
    }, [value]);

    useEffect(() => {
        return () => {
            finalizeDragRef.current();
        };
    }, []);

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finalizeDragRef.current();
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finalizeDragRef.current();
            }
        };

        window.addEventListener('blur', handleWindowBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('blur', handleWindowBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // The snap-home dead-zone must stay smaller than one keyboard step of the
    // active resolution. A fixed (max-min)*1% zone is wider than a step for
    // bipolar fine-stepped knobs (e.g. -1..1, step 0.01 → ±0.02 zone), so an
    // arrow keystroke computed the next value, the clamp snapped it straight
    // back to the default, and the Object.is guard swallowed the change —
    // keyboard alone could never leave the default. Half of the smaller of
    // (step, 1% of range) still catches a pointer release that lands near the
    // default, which is the gesture the snap exists for.
    const clamp = (value1: number, currentStep: number = step): number => {
        const snapZone = Math.min(currentStep, (max - min) * 0.01) / 2;
        let clamped = Math.max(min, Math.min(max, value1));
        if (bipolar && Math.abs(clamped - defaultValue) < snapZone) {
            clamped = defaultValue;
        }
        return clamped;
    };

    const quantize = (raw: number, currentStep: number): number => {
        const safeStep = Math.max(Number.EPSILON, currentStep);
        const stepFromMin = Math.round((raw - min) / safeStep);
        const quantized = min + stepFromMin * safeStep;
        return clamp(Number(quantized.toPrecision(15)), safeStep);
    };

    const resetToDefault = () => {
        if (disabled || Object.is(value, defaultValue)) {
            return;
        }
        onChange(defaultValue, false);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || activePointerIdRef.current !== null || event.button !== 0) {
            return;
        }
        if (event.altKey) {
            resetToDefault();
            return;
        }
        const gestureToken = gestureAuthorityRef.current?.acquire(() => finalizeDragRef.current()) ?? gestureOwner;
        event.currentTarget.setPointerCapture(event.pointerId);
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
        const clamped = quantize(raw, currentStep);
        if (Object.is(clamped, currentValue.current)) {
            return;
        }
        currentValue.current = clamped;
        onChangeRef.current(clamped, true);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (disabled || draggingRef.current) {
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
        const currentStep = Math.max(Number.EPSILON, event.shiftKey ? fineStep : step);
        const liveValue = currentValue.current;
        let nextValue: number;
        if (isHome) {
            nextValue = clamp(min);
        } else if (isEnd) {
            nextValue = clamp(max);
        } else {
            const direction = isIncrement ? 1 : -1;
            nextValue = quantize(liveValue + direction * currentStep, currentStep);
        }
        if (Object.is(nextValue, liveValue)) {
            return;
        }

        const authority = gestureAuthorityRef.current;
        if (authority) {
            const token = authority.acquire(() => finalizeDragRef.current());
            if (!authority.isCurrent(token)) {
                return;
            }
        }
        currentValue.current = nextValue;
        onChangeRef.current(nextValue, false);
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
        finalizeDragRef.current(event.pointerId);
    };

    const handleDoubleClick = () => {
        resetToDefault();
    };

    const rotation = -135 + normalized * 270;

    // Conic arc gradient for the value ring
    const arcAngleDeg = normalized * 270;
    const arcColor = TONE_COLORS[tone];
    const arcBg = bipolar
        ? buildBipolarArc(normalized, arcColor)
        : `conic-gradient(from 225deg, ${arcColor} 0deg, ${arcColor} ${arcAngleDeg}deg, transparent ${arcAngleDeg}deg, transparent 270deg, transparent 270deg)`;
    const accessibleName = ariaLabel ?? label ?? paramId ?? 'Parameter control';
    const ariaValue = Math.max(min, Math.min(max, value));
    const handleFocusLoss = (): void => {
        finalizeDragRef.current();
    };

    return (
        <div
            ref={rootRef}
            role="slider"
            tabIndex={0}
            aria-label={accessibleName}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={ariaValue}
            aria-disabled={disabled || undefined}
            title={title}
            className={cn(
                'group/knob relative flex flex-col items-center select-none touch-none',
                disabled ? 'cursor-not-allowed opacity-45' : 'cursor-ns-resize',
                label && 'min-w-fit',
                className
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onLostPointerCapture={handlePointerUp}
            onKeyDown={handleKeyDown}
            onBlur={handleFocusLoss}
            onDoubleClick={handleDoubleClick}
            onContextMenu={onContextMenu}
        >
            {isLearning ? (
                <div className="absolute inset-[-4px] rounded-full border border-dashed border-[var(--color-accent-lavender)] animate-pulse pointer-events-none z-10" />
            ) : null}
            {isMapped && !isLearning ? (
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
