'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '#/helpers/Styles/cn';

function Slider({
    className,
    defaultValue,
    value,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
    const _values = React.useMemo(
        () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
        [value, defaultValue, min, max]
    );

    return (
        <SliderPrimitive.Root
            data-slot="slider"
            defaultValue={defaultValue}
            value={value}
            min={min}
            max={max}
            className={cn(
                'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
                className
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className={cn(
                    'relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
                )}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className={cn(
                        'absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
                    )}
                />
            </SliderPrimitive.Track>
            {Array.from({ length: _values.length }, (_, index) => (
                <SliderThumbNode
                    key={index}
                    index={index}
                    values={_values}
                    min={min}
                    max={max}
                    defaultValue={defaultValue}
                    onValueChange={onValueChange}
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
}: {
    index: number;
    values: number[];
    min: number;
    max: number;
    defaultValue?: number[];
    onValueChange?: (value: number[]) => void;
}) {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editVal, setEditVal] = React.useState(String(values[index] ?? 0));

    return (
        <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            className="block size-4 shrink-0 rounded-full border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
            onPointerDown={(e) => {
                if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (defaultValue && onValueChange) {
                        onValueChange(Array.isArray(defaultValue) ? defaultValue : [defaultValue as number]);
                    }
                }
            }}
            onDoubleClick={() => {
                setEditVal(String(values[index] ?? 0));
                setIsEditing(true);
            }}
        >
            {isEditing && (
                <input
                    autoFocus
                    className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 rounded bg-surface-overlay text-foreground text-[10px] text-center px-1 py-0.5 border border-primary outline-none ring-1 ring-primary z-50"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => setIsEditing(false)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const num = Number(editVal);
                            if (!isNaN(num) && onValueChange) {
                                const newVals = [...values];
                                newVals[index] = Math.max(min, Math.min(max, num));
                                onValueChange(newVals);
                            }
                            setIsEditing(false);
                        }
                        if (e.key === 'Escape') {
                            setIsEditing(false);
                        }
                        e.stopPropagation();
                    }}
                />
            )}
        </SliderPrimitive.Thumb>
    );
}

export { Slider };
