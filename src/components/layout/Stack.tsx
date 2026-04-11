import { type ReactElement, type ReactNode, type ElementType, type ComponentPropsWithoutRef } from 'react';

import { cn } from '#/helpers/Styles/cn';

type StackElement = ElementType;

type GapValue = 0 | 1 | 2 | 3 | 4 | 6 | 8;
type AlignValue = 'start' | 'center' | 'end' | 'stretch';
type JustifyValue = 'start' | 'center' | 'end' | 'between';

type StackProps<T extends StackElement = 'div'> = Omit<ComponentPropsWithoutRef<T>, 'as'> & {
    as?: T;
    gap?: GapValue;
    align?: AlignValue;
    justify?: JustifyValue;
    grow?: boolean;
    shrink?: boolean;
    wrap?: boolean;
    children: ReactNode;
};

const GAP_CLASS_NAMES: Record<GapValue, string> = {
    0: 'gap-0',
    1: 'gap-1',
    2: 'gap-2',
    3: 'gap-3',
    4: 'gap-4',
    6: 'gap-6',
    8: 'gap-8',
};

const ALIGN_CLASS_NAMES: Record<AlignValue, string> = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
};

const JUSTIFY_CLASS_NAMES: Record<JustifyValue, string> = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
};

export const Stack = <T extends StackElement = 'div'>({
    as,
    gap = 0,
    align = 'stretch',
    justify = 'start',
    grow = false,
    shrink = true,
    wrap = false,
    className,
    children,
    ...props
}: StackProps<T>): ReactElement => {
    const Component = as ?? 'div';
    return (
        <Component
            className={cn(
                'flex flex-col min-h-0',
                GAP_CLASS_NAMES[gap],
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
