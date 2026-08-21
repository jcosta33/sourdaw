import { type ReactElement, type PointerEvent } from 'react';

import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/utils/Styles/cn';

type BipolarSliderProps = {
    value: number;
    onValueChange: (val: number) => void;
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
    label?: string;
    'aria-label'?: string;
    formatValue?: (val: number) => string;
    className?: string;
};

export const BipolarSlider = ({
    value,
    onValueChange,
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

    const handleChange = ([v]: number[]) => {
        if (v === undefined) {
            return;
        }
        const mapped = min + (v / 100) * range;
        onValueChange(mapped);
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            onValueChange(defaultValue);
        }
    };

    return (
        <div className={cn('flex flex-col gap-1 w-full', className)}>
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
                    max={100}
                    step={step > 0 ? (step / range) * 100 : 0.1}
                    className="z-10"
                />
            </Row>
            {!label ? (
                <Row justify="center">
                    <span className="text-[9px] font-mono text-muted-foreground">{formatValue(value)}</span>
                </Row>
            ) : null}
        </div>
    );
};
