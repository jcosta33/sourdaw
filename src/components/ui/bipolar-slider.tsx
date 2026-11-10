import { type ReactElement, type PointerEvent } from 'react';

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
    /** Render the built-in value readout. Turn off when the caller shows the value itself. */
    showValue?: boolean;
    'aria-label'?: string;
    formatValue?: (val: number) => string;
    className?: string;
};

export const BipolarSlider = ({
    value,
    onValueChange,
    onValueCommit,
    min,
    max,
    step = 0.1,
    defaultValue = 0,
    label,
    showValue = true,
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
    const toDomain = (position: number): number => min + (position / 100) * range;

    const handleChange = ([position]: number[]): void => {
        if (position !== undefined) {
            onValueChange(toDomain(position));
        }
    };
    const handleCommit = ([position]: number[]): void => {
        if (position !== undefined) {
            onValueCommit?.(toDomain(position));
        }
    };
    // A modifier click resets to the default as one complete edit.
    const handleResetPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (!event.metaKey && !event.ctrlKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onValueChange(defaultValue);
        onValueCommit?.(defaultValue);
    };

    return (
        <div className={cn('flex flex-col gap-1 w-full', className)}>
            {label ? (
                <Row justify="between" className="px-1">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    {showValue ? (
                        <span className="text-[10px] font-mono text-muted-foreground">{formatValue(value)}</span>
                    ) : null}
                </Row>
            ) : null}
            <Row className="relative h-6 px-1 pt-2 pb-1" onPointerDownCapture={handleResetPointerDown}>
                {/* Center tick */}
                <div
                    className="absolute top-1 bottom-1 w-[2px] bg-white/10 z-0 transform -translate-x-1/2 pointer-events-none"
                    style={{ left: `${normalizedDefault}%` }}
                />

                <Slider
                    aria-label={ariaLabel ?? label ?? 'Bipolar value'}
                    value={[normalized]}
                    onValueChange={handleChange}
                    onValueCommit={onValueCommit ? handleCommit : undefined}
                    max={100}
                    step={step > 0 ? (step / range) * 100 : 0.1}
                    className="z-10"
                />
            </Row>
            {!label && showValue ? (
                <Row align="stretch" justify="center">
                    <span className="text-[9px] font-mono text-muted-foreground">{formatValue(value)}</span>
                </Row>
            ) : null}
        </div>
    );
};
