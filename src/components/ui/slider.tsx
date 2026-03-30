'use client';

import { type ComponentProps, useState } from 'react';
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
}: ComponentProps<typeof SliderPrimitive.Root>) {
    const computeValues = (): number[] => {
        if (value != null) {
            return Array.isArray(value) ? value : [value];
        }
        if (defaultValue != null) {
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
                    'relative grow overflow-hidden rounded-full border border-black/50 data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
                )}
                style={{
                    background: 'linear-gradient(180deg, #060606 0%, #0a0a0a 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.03)',
                    borderTopColor: 'rgba(0,0,0,0.7)',
                    borderBottomColor: 'rgba(40,40,40,0.3)',
                }}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className={cn(
                        'absolute bg-accent-cyan/80 data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
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
    const [isEditing, setIsEditing] = useState(false);
    const [editVal, setEditVal] = useState(String(values[index] ?? 0));

    return (
        <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            className="block size-4 shrink-0 rounded-[4px] border cursor-pointer outline-none transition-[color,box-shadow] hover:ring-2 hover:ring-accent-cyan/30 focus-visible:ring-4 focus-visible:ring-accent-cyan/40 disabled:pointer-events-none disabled:opacity-50"
            style={{
                background: 'linear-gradient(180deg, #555 0%, #3e3e3e 25%, #353535 50%, #2c2c2c 75%, #222 100%)',
                borderColor: 'rgba(255,255,255,0.05)',
                borderTopColor: 'rgba(255,255,255,0.12)',
                borderLeftColor: 'rgba(255,255,255,0.06)',
                borderBottomColor: 'rgba(0,0,0,0.4)',
                borderRightColor: 'rgba(0,0,0,0.2)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
            onPointerDown={(event) => {
                if (event.metaKey || event.ctrlKey) {
                    event.preventDefault();
                    event.stopPropagation();
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
            {isEditing ? (
                <input
                    autoFocus
                    className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 rounded bg-surface-overlay text-foreground text-[10px] text-center px-1 py-0.5 border border-border outline-none ring-1 ring-accent-cyan z-50 shadow-elevation-floating"
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
