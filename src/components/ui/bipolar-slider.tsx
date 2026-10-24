import { type ReactElement, type PointerEvent, useEffect, useLayoutEffect, useRef } from 'react';

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

    const pendingValue = useRef<number | null>(null);
    const activePointerId = useRef<number | null>(null);
    const commitPending = (): void => {
        const pending = pendingValue.current;
        pendingValue.current = null;
        activePointerId.current = null;
        if (pending !== null) {
            onValueCommit?.(pending);
        }
    };
    useBipolarSliderCompletion(onValueCommit !== undefined, commitPending);

    const handleChange = ([v]: number[]) => {
        if (v === undefined) {
            return;
        }
        const mapped = min + (v / 100) * range;
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

    return (
        <div
            className={cn('flex flex-col gap-1 w-full', className)}
            onPointerCancel={finishPointer}
            onLostPointerCapture={finishPointer}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    commitPending();
                }
            }}
        >
            {label ? (
                <Row justify="between" className="px-1">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{formatValue(value)}</span>
                </Row>
            ) : null}
            <Row className="relative h-6 px-1 pt-2 pb-1" onPointerDownCapture={handlePointerDown}>
                {/* Center tick */}
                <div
                    className="absolute top-1 bottom-1 w-[2px] bg-white/10 z-0 transform -translate-x-1/2 pointer-events-none"
                    style={{ left: `${normalizedDefault}%` }}
                />

                <Slider
                    aria-label={ariaLabel ?? label ?? 'Bipolar value'}
                    value={[normalized]}
                    onValueChange={handleChange}
                    onValueCommit={commitPending}
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
