'use client';

import { type ComponentProps, useState } from 'react';

import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '#/utils/Styles/cn';

function Slider({
    className,
    trackClassName,
    rangeClassName,
    thumbClassName,
    defaultValue,
    value,
    onValueChange,
    onValueCommit,
    min = 0,
    max = 100,
    step = 1,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...props
}: ComponentProps<typeof SliderPrimitive.Root> & {
    trackClassName?: string;
    rangeClassName?: string;
    thumbClassName?: string;
}) {
    const computeValues = (): number[] => {
        if (value !== null && value !== undefined) {
            return Array.isArray(value) ? value : [value];
        }
        if (defaultValue !== null && defaultValue !== undefined) {
            return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
        }
        // No value provided — single thumb at midpoint
        return [Math.round((min + max) / 2)];
    };
    const _values = computeValues();

    return (
        <SliderPrimitive.Root
            data-slot="slider"
            defaultValue={defaultValue}
            value={value}
            onValueChange={onValueChange}
            onValueCommit={onValueCommit}
            min={min}
            max={max}
            step={step}
            className={cn(
                'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
                className
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className={cn(
                    'daw-inset-surface relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
                    trackClassName
                )}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className={cn(
                        'absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
                        '[background:linear-gradient(180deg,rgba(127,184,196,0.92)_0%,rgba(127,184,196,0.62)_100%)]',
                        'shadow-[0_0_10px_rgba(127,184,196,0.12)]',
                        rangeClassName
                    )}
                />
            </SliderPrimitive.Track>
            {Array.from({ length: _values.length }, (_, thumbIndex) => (
                <SliderThumbNode
                    key={thumbIndex}
                    index={thumbIndex}
                    values={_values}
                    min={min}
                    max={max}
                    defaultValue={defaultValue}
                    onValueChange={onValueChange}
                    onValueCommit={onValueCommit}
                    thumbClassName={thumbClassName}
                    ariaLabel={ariaLabel}
                    ariaLabelledBy={ariaLabelledBy}
                />
            ))}
        </SliderPrimitive.Root>
    );
}

function SliderThumbNode({
    index,
    values,
    min,
    max,
    defaultValue,
    onValueChange,
    onValueCommit,
    thumbClassName,
    ariaLabel,
    ariaLabelledBy,
}: {
    index: number;
    values: number[];
    min: number;
    max: number;
    defaultValue?: number[];
    onValueChange?: (value: number[]) => void;
    onValueCommit?: (value: number[]) => void;
    thumbClassName?: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editVal, setEditVal] = useState(String(values[index] ?? 0));

    return (
        <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={cn(
                'block size-4 shrink-0 rounded-[4px] border cursor-pointer outline-none transition-[color,box-shadow,filter,transform] hover:ring-2 hover:ring-accent-cyan/25 hover:brightness-105 focus-visible:ring-4 focus-visible:ring-accent-cyan/35 disabled:pointer-events-none disabled:opacity-50',
                thumbClassName
            )}
            style={{
                background: 'linear-gradient(180deg, #575757 0%, #404040 22%, #343434 52%, #2a2a2a 76%, #1f1f1f 100%)',
                borderColor: 'rgba(255,255,255,0.05)',
                borderTopColor: 'rgba(255,255,255,0.12)',
                borderLeftColor: 'rgba(255,255,255,0.06)',
                borderBottomColor: 'rgba(0,0,0,0.4)',
                borderRightColor: 'rgba(0,0,0,0.2)',
                boxShadow:
                    '0 2px 4px rgba(0,0,0,0.68), inset 0 1px 0 rgba(255,255,255,0.11), inset 0 -1px 0 rgba(0,0,0,0.28)',
            }}
            onPointerDown={(event) => {
                if (event.metaKey || event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (defaultValue && onValueChange) {
                        onValueChange(Array.isArray(defaultValue) ? defaultValue : [defaultValue]);
                    }
                }
            }}
            onDoubleClick={() => {
                setEditVal(String(values[index] ?? 0));
                setIsEditing(true);
            }}
        >
            {isEditing ? (
                <input
                    autoFocus
                    className="daw-floating-surface absolute -top-6 left-1/2 z-50 w-12 -translate-x-1/2 rounded px-1 py-0.5 text-center text-[10px] text-foreground outline-none ring-1 ring-accent-cyan/35"
                    value={editVal}
                    onChange={(changeEvent) => setEditVal(changeEvent.target.value)}
                    onBlur={() => setIsEditing(false)}
                    onKeyDown={(keyEvent) => {
                        if (keyEvent.key === 'Enter') {
                            const num = Number(editVal);
                            if (!isNaN(num) && onValueChange) {
                                const newVals = [...values];
                                newVals[index] = Math.max(min, Math.min(max, num));
                                onValueChange(newVals);
                                onValueCommit?.(newVals);
                            }
                            setIsEditing(false);
                        }
                        if (keyEvent.key === 'Escape') {
                            setIsEditing(false);
                        }
                        keyEvent.stopPropagation();
                    }}
                />
            ) : null}
        </SliderPrimitive.Thumb>
    );
}

export { Slider };
