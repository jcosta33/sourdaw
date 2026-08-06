import {
    type ReactElement,
    type PointerEvent,
    type KeyboardEvent,
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
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

const TONE_CLASS_NAMES: Record<Tone, string> = {
    neutral: 'bg-white/50',
    amber: 'bg-[var(--color-accent-amber)]',
    cyan: 'bg-[var(--color-accent-cyan)]',
    peach: 'bg-[var(--color-accent-peach)]',
    lavender: 'bg-[var(--color-accent-lavender)]',
    mint: 'bg-[var(--color-accent-mint)]',
    steel: 'bg-[var(--color-accent-steel)]',
    danger: 'bg-[var(--color-state-danger)]',
    rose: 'bg-[var(--color-accent-rose)]',
    indigo: 'bg-[var(--color-accent-indigo)]',
    sage: 'bg-[var(--color-accent-sage)]',
    copper: 'bg-[var(--color-accent-copper)]',
};

type FaderProps = {
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
    /** Color tone for the active cap indicator */
    tone?: Tone;
    /**
     * audit M-083: accessible name for the slider itself. `aria-label` on the
     * surrounding markup does not name this control — the wrapper has no role,
     * so the label has no ARIA mapping and is dropped. Two call sites were
     * already passing this attribute into a props type that did not declare it;
     * TypeScript exempts hyphenated JSX attributes from excess-property checks,
     * so those labels vanished silently.
     */
    'aria-label'?: string;
    /**
     * audit M-083: unit for the announced value (e.g. `dB`). When set, the
     * slider reports `aria-valuetext` so assistive tech reads "-10 dB" rather
     * than a bare number. Omit it where the value is already unitless.
     */
    unit?: string;
};

/** dB marks for the fader scale */
const DB_MARKS = [6, 0, -6, -12, -24, -48] as const;

/** Keyboard coarse step (PageUp/PageDown) as a multiple of the normal step. */
const COARSE_STEP_MULTIPLIER = 10;

/**
 * Snap onto the step grid without the binary-float residue that bare
 * `Math.round(v / step) * step` leaves behind — at `step = 0.1` it turns 5.1
 * into 5.1000000000000005, which is invisible in the readout and permanent in
 * the project. Mirrors `ValueField`'s `snapToStep`.
 */
function snapToStep(value: number, stepSize: number): number {
    if (!(stepSize > 0)) {
        return value;
    }
    return Number((Math.round(value / stepSize) * stepSize).toPrecision(12));
}

/**
 * Fader
 * Vertical mixer fader with metallic cap, groove track, and dB scale.
 * Drag cap to slide, Shift for fine mode, double-click to reset.
 * Arrow keys step, Home/End jump to the bounds, PageUp/PageDown move coarsely.
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
    tone = 'cyan',
    unit,
    'aria-label': ariaLabel,
}: FaderProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const draggingRef = useRef(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const startY = useRef(0);
    const startValue = useRef(value);
    /** audit M-082: the id of the captured pointer, so a finalizer that has no event can still release it. */
    const activePointerIdRef = useRef<number | null>(null);
    const finalizeDragRef = useRef<() => void>(() => {});

    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));

    const clampAndSnap = (value1: number) => {
        let clamped = Math.max(min, Math.min(max, value1));
        if (bipolar && Math.abs(clamped - defaultValue) < (max - min) * 0.05) {
            clamped = defaultValue;
        }
        return clamped;
    };

    /**
     * audit M-082: the single exit from a drag. Previously only `pointerup` on
     * the element cleared `draggingRef`, so a `pointercancel` (touch gesture
     * stolen by the OS) or an implicit capture release left the drag latched
     * forever — every later `pointermove` over the fader, plain hover with no
     * button held, kept writing the level. Every way a drag can end now routes
     * here. Matches `RotaryKnob`'s cancel / lost-capture / blur / visibility set.
     */
    const finalizeDrag = (): void => {
        if (!draggingRef.current) {
            return;
        }
        const pointerId = activePointerIdRef.current;
        draggingRef.current = false;
        activePointerIdRef.current = null;
        setIsDragging(false);
        if (pointerId === null || !rootRef.current) {
            return;
        }
        if (typeof rootRef.current.releasePointerCapture !== 'function') {
            return;
        }
        try {
            rootRef.current.releasePointerCapture(pointerId);
        } catch {
            // The browser may have already released capture before this finalizer runs.
        }
    };

    useLayoutEffect(() => {
        finalizeDragRef.current = finalizeDrag;
    });

    // audit M-082: a drag interrupted by a window/tab switch never sees pointerup.
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

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !trackRef.current) {
            return;
        }
        if (event.altKey) {
            onChange(defaultValue);
            return;
        }
        if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        activePointerIdRef.current = event.pointerId;
        draggingRef.current = true;
        setIsDragging(true);

        const capEl = event.currentTarget.querySelector('[data-role="fader-cap"]');
        const isCapClick = capEl?.contains(event.target as Node);

        if (!isCapClick) {
            const rect = trackRef.current.getBoundingClientRect();
            const percent = 1 - (event.clientY - rect.top) / rect.height;
            const newValue = clampAndSnap(min + percent * (max - min));
            onChange(newValue);
            startValue.current = newValue;
            startY.current = event.clientY;
        } else {
            startValue.current = value;
            startY.current = event.clientY;
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
            return;
        }
        const deltaY = startY.current - event.clientY;
        const currentStep = event.shiftKey ? fineStep : step;
        const pxPerUnit = height / (max - min);
        let sensitivity = 1 / pxPerUnit;
        if (event.shiftKey) {
            sensitivity *= 0.1;
        }
        let newValue = startValue.current + deltaY * sensitivity;
        newValue = Math.round(newValue / currentStep) * currentStep;
        onChange(clampAndSnap(newValue));
    };

    const handlePointerUp = () => {
        finalizeDrag();
    };

    /**
     * audit M-083: the APG slider keyboard contract — arrows step, Shift for the
     * fine step, Home/End to the bounds, PageUp/PageDown coarse. `onChange` has no
     * transient flag, so each keypress is one committed write, not a stream.
     * https://www.w3.org/WAI/ARIA/apg/patterns/slider/
     */
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (draggingRef.current) {
            return;
        }

        const isIncrement = event.key === 'ArrowUp' || event.key === 'ArrowRight';
        const isDecrement = event.key === 'ArrowDown' || event.key === 'ArrowLeft';
        const isCoarseIncrement = event.key === 'PageUp';
        const isCoarseDecrement = event.key === 'PageDown';
        const isHome = event.key === 'Home';
        const isEnd = event.key === 'End';
        if (!isIncrement && !isDecrement && !isCoarseIncrement && !isCoarseDecrement && !isHome && !isEnd) {
            return;
        }

        event.preventDefault();

        let nextValue: number;
        if (isHome) {
            nextValue = clampAndSnap(min);
        } else if (isEnd) {
            nextValue = clampAndSnap(max);
        } else {
            let currentStep = step;
            if (event.shiftKey) {
                currentStep = fineStep;
            }
            if (isCoarseIncrement || isCoarseDecrement) {
                currentStep = step * COARSE_STEP_MULTIPLIER;
            }
            let direction = 1;
            if (isDecrement || isCoarseDecrement) {
                direction = -1;
            }
            nextValue = clampAndSnap(snapToStep(value + direction * currentStep, currentStep));
        }

        if (Object.is(nextValue, value)) {
            return;
        }
        onChange(nextValue);
    };

    const handleDoubleClick = () => {
        onChange(defaultValue);
    };

    const capBottomPct = normalized * 100;
    const unityPct = Math.max(0, Math.min(100, ((defaultValue - min) / (max - min)) * 100));

    // audit M-083: the value the accessibility tree reports, kept inside the declared bounds.
    const reportedValue = Math.max(min, Math.min(max, value));
    let valueText: string | undefined;
    if (unit) {
        valueText = `${Math.round(reportedValue * 100) / 100} ${unit}`;
    }

    return (
        <div
            ref={rootRef}
            // audit M-083: this was a bare div with pointer handlers only — no role,
            // no value, no name, no tab stop. A fader is a slider; the vertical
            // orientation has to be declared because the ARIA default is horizontal.
            // https://www.w3.org/WAI/ARIA/apg/patterns/slider/
            role="slider"
            tabIndex={0}
            aria-label={ariaLabel ?? 'Level'}
            aria-orientation="vertical"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={reportedValue}
            aria-valuetext={valueText}
            className={cn(
                'relative flex items-center select-none group',
                'outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                className
            )}
            style={{ height }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            // audit M-082: every non-pointerup end of a drag, not just the happy path.
            onPointerCancel={handlePointerUp}
            onLostPointerCapture={handlePointerUp}
            onBlur={handlePointerUp}
            onKeyDown={handleKeyDown}
            onDoubleClick={handleDoubleClick}
        >
            {/* dB scale marks (left side) */}
            {showScale ? (
                <div className="pointer-events-none absolute -left-6 top-0 bottom-0 flex w-5 flex-col justify-between">
                    {DB_MARKS.map((db) => {
                        const pct = ((db - min) / (max - min)) * 100;
                        return (
                            <span
                                key={db}
                                className={cn(
                                    'absolute right-0 font-mono text-[8px] leading-none tracking-[0.08em]',
                                    db === 0 ? 'text-text-primary' : 'text-text-disabled'
                                )}
                                style={{ bottom: `${pct}%`, transform: 'translateY(50%)' }}
                            >
                                {db > 0 ? `+${db}` : String(db)}
                            </span>
                        );
                    })}
                </div>
            ) : null}

            {/* Track groove */}
            <div
                ref={trackRef}
                className="daw-inset-surface absolute top-0 bottom-0 left-1/2 w-[5px] -translate-x-1/2 overflow-hidden rounded-full"
                style={{
                    background:
                        'linear-gradient(90deg, rgba(255,255,255,0.012) 0%, rgba(255,255,255,0.02) 48%, rgba(0,0,0,0.16) 100%), linear-gradient(90deg, #070707 0%, #0b0b0b 44%, #080808 100%)',
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
                {showScale
                    ? DB_MARKS.map((db) => {
                          const pct = ((db - min) / (max - min)) * 100;
                          return (
                              <div
                                  key={db}
                                  className="absolute right-0 w-[2px] h-px bg-white/10"
                                  style={{ bottom: `${pct}%` }}
                              />
                          );
                      })
                    : null}
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
                        ? 'linear-gradient(180deg, #484848 0%, #373737 24%, #2d2d2d 52%, #252525 76%, #1e1e1e 100%)'
                        : 'linear-gradient(180deg, #545454 0%, #3e3e3e 25%, #353535 50%, #2b2b2b 75%, #222 100%)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderTopColor: isDragging ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.12)',
                    borderLeftColor: isDragging ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
                    borderBottomColor: 'rgba(0,0,0,0.4)',
                    borderRightColor: 'rgba(0,0,0,0.2)',
                    boxShadow: isDragging
                        ? 'inset 0 2px 4px rgba(0,0,0,0.6)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.24), 0 2px 4px rgba(0,0,0,0.6)',
                }}
            >
                {/* Center groove marks */}
                <div className={cn('w-4 h-px', isDragging ? TONE_CLASS_NAMES[tone] : 'bg-white/10')} />
                <div className="w-5 h-px bg-white/15" />
                <div className={cn('w-4 h-px', isDragging ? TONE_CLASS_NAMES[tone] : 'bg-white/10')} />
            </div>
        </div>
    );
};
