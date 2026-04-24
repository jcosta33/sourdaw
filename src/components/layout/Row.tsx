import { type ReactElement, type ReactNode, type ElementType, type ComponentPropsWithoutRef } from 'react';

import { cn } from '#/utils/Styles/cn';

type RowElement = ElementType;

type GapValue = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 6 | 8;
type AlignValue = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type JustifyValue = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

type RowProps<Element extends RowElement = 'div'> = Omit<ComponentPropsWithoutRef<Element>, 'as'> & {
    as?: Element;
    gap?: GapValue;
    align?: AlignValue;
    justify?: JustifyValue;
    grow?: boolean;
    shrink?: boolean;
    wrap?: boolean;
    children: ReactNode;
};

const GAP_CLASS_NAMES: Record<string, string> = {
    '0': 'gap-0',
    '0.5': 'gap-0.5',
    '1': 'gap-1',
    '1.5': 'gap-1.5',
    '2': 'gap-2',
    '2.5': 'gap-2.5',
    '3': 'gap-3',
    '4': 'gap-4',
    '6': 'gap-6',
    '8': 'gap-8',
};

const ALIGN_CLASS_NAMES: Record<AlignValue, string> = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline',
};

const JUSTIFY_CLASS_NAMES: Record<JustifyValue, string> = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
    evenly: 'justify-evenly',
};

export const Row = <Element extends RowElement = 'div'>({
    as,
    gap = 0,
    align = 'center',
    justify = 'start',
    grow = false,
    shrink = true,
    wrap = false,
    className,
    children,
    ...props
}: RowProps<Element>): ReactElement => {
    const Component = as ?? 'div';
    return (
        <Component
            className={cn(
                'flex flex-row min-w-0',
                GAP_CLASS_NAMES[String(gap)],
                ALIGN_CLASS_NAMES[align],
                JUSTIFY_CLASS_NAMES[justify],
                grow && 'flex-1',
                !shrink && 'shrink-0',
                wrap && 'flex-wrap',
                className
            )}
            {...props}
        >
            {children}
        </Component>
    );
};
