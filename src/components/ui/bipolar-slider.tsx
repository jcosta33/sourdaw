import {
    type FocusEvent,
    type KeyboardEvent,
    type ReactElement,
    type PointerEvent,
    useEffect,
    useLayoutEffect,
    useRef,
} from 'react';

import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/utils/Styles/cn';

type BipolarSliderProps = {
    value: number;
    onValueChange: (val: number) => void;
    onValueCommit?: (val: number) => void;
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
    label?: string;
    'aria-label'?: string;
    formatValue?: (val: number) => string;
    className?: string;
};

function useBipolarSliderCompletion(hasCommitHandler: boolean, commitPending: () => void): void {
    const commitRef = useRef<() => void>(() => undefined);
    useLayoutEffect(() => {
        commitRef.current = commitPending;
    });
    useEffect(() => {
        if (!hasCommitHandler) {
            return undefined;
        }
        const finish = (): void => commitRef.current();
        const visibilityChanged = (): void => {
            if (document.visibilityState === 'hidden') {
                finish();
            }
        };
        window.addEventListener('blur', finish);
        document.addEventListener('visibilitychange', visibilityChanged);
        return () => {
            window.removeEventListener('blur', finish);
            document.removeEventListener('visibilitychange', visibilityChanged);
            finish();
        };
    }, [hasCommitHandler]);
}

type BipolarSliderGestureProps = Pick<
    BipolarSliderProps,
    'value' | 'onValueChange' | 'onValueCommit' | 'min' | 'defaultValue'
> & { range: number };

function useBipolarSliderGesture({
    value,
    onValueChange,
    onValueCommit,
    min,
    range,
    defaultValue = 0,
}: BipolarSliderGestureProps) {
    const pendingValue = useRef<number | null>(null);
    const settledValue = useRef<number | null>(null);
    const activePointerId = useRef<number | null>(null);
    const handlingSliderKey = useRef(false);
    useLayoutEffect(() => {
        if (settledValue.current !== value) {
            settledValue.current = null;
        }
    }, [value]);
    const commitPending = (committed?: number[]): void => {
        const normalizedCommit = committed?.[0];
        const pending = pendingValue.current;
        if (pending === null && activePointerId.current === null && !handlingSliderKey.current) {
            return;
        }
        let finalValue = pending;
        if (normalizedCommit !== undefined) {
            finalValue = min + (normalizedCommit / 100) * range;
        }
        pendingValue.current = null;
        activePointerId.current = null;
        if (finalValue !== null && finalValue !== settledValue.current) {
            // Radix can commit a keyboard value before its change callback, even during a pointer edit.
            if (finalValue !== pending) {
                onValueChange(finalValue);
            }
            settledValue.current = finalValue;
            onValueCommit?.(finalValue);
        }
    };
    useBipolarSliderCompletion(onValueCommit !== undefined, commitPending);

    const handleChange = ([v]: number[]) => {
        if (v === undefined) {
            return;
        }
        const mapped = min + (v / 100) * range;
        if (mapped === settledValue.current && pendingValue.current === null) {
            return;
        }
        settledValue.current = null;
        if (onValueCommit) {
            pendingValue.current = mapped;
        }
        onValueChange(mapped);
    };

    const finishPointer = (event: PointerEvent<HTMLDivElement>): void => {
        if (activePointerId.current === event.pointerId) {
            commitPending();
        }
    };
    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (onValueCommit && event.button === 0) {
            activePointerId.current = event.pointerId;
        }
        if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            if (onValueCommit) {
                pendingValue.current = defaultValue;
            }
            onValueChange(defaultValue);
            commitPending();
        }
    };
    const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
        handlingSliderKey.current = event.target instanceof HTMLElement && event.target.role === 'slider';
    };
    const handleKeyDown = (): void => {
        handlingSliderKey.current = false;
    };
    const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            commitPending();
        }
    };

    return {
        commitPending,
        handleChange,
        finishPointer,
        handlePointerDown,
        handleKeyDownCapture,
        handleKeyDown,
        handleBlur,
    };
}

export const BipolarSlider = ({
    value,
    onValueChange,
    onValueCommit,
    min,
    max,
    step = 0.1,
    defaultValue = 0,
    label,
    'aria-label': ariaLabel,
    formatValue = (v) => v.toFixed(1),
    className,
}: BipolarSliderProps): ReactElement => {
    // We visually represent this as a slider from 0-100 where 50 is center (0)
    // assuming min is negative and max is positive and symmetric, or close to it.
    const range = max - min;
    const normalized = range === 0 ? 50 : ((value - min) / range) * 100;

    // Default position
    const normalizedDefault = range === 0 ? 50 : ((defaultValue - min) / range) * 100;
    const gesture = useBipolarSliderGesture({ value, onValueChange, onValueCommit, min, range, defaultValue });

    return (
        <div
            className={cn('flex flex-col gap-1 w-full', className)}
            onKeyDownCapture={gesture.handleKeyDownCapture}
            onKeyDown={gesture.handleKeyDown}
            onPointerCancel={gesture.finishPointer}
            onLostPointerCapture={gesture.finishPointer}
            onBlur={gesture.handleBlur}
        >
            {label ? (
                <Row justify="between" className="px-1">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{formatValue(value)}</span>
                </Row>
            ) : null}
            <Row className="relative h-6 px-1 pt-2 pb-1" onPointerDownCapture={gesture.handlePointerDown}>
                {/* Center tick */}
                <div
                    className="absolute top-1 bottom-1 w-[2px] bg-white/10 z-0 transform -translate-x-1/2 pointer-events-none"
                    style={{ left: `${normalizedDefault}%` }}
                />

                <Slider
                    aria-label={ariaLabel ?? label ?? 'Bipolar value'}
                    value={[normalized]}
                    onValueChange={gesture.handleChange}
                    onValueCommit={gesture.commitPending}
                    max={100}
                    step={step > 0 ? (step / range) * 100 : 0.1}
                    className="z-10"
                />
            </Row>
            {!label ? (
                <Row align="stretch" justify="center">
                    <span className="text-[9px] font-mono text-muted-foreground">{formatValue(value)}</span>
                </Row>
            ) : null}
        </div>
    );
};
