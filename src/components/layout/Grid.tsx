import { type ReactElement, type ReactNode, type ElementType, type ComponentPropsWithoutRef } from 'react';

import { cn } from '#/helpers/Styles/cn';

type GridElement = ElementType;

type ColsValue = 1 | 2 | 3 | 4 | 5 | 6;
type GapValue = 0 | 1 | 2 | 3 | 4 | 6 | 8;
type FlowValue = 'row' | 'col';

type GridProps<T extends GridElement = 'div'> = Omit<ComponentPropsWithoutRef<T>, 'as'> & {
    as?: T;
    cols?: ColsValue;
    gap?: GapValue;
    gapX?: GapValue;
    gapY?: GapValue;
    flow?: FlowValue;
    children: ReactNode;
};

const COLS_CLASS_NAMES: Record<ColsValue, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
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

const GAP_X_CLASS_NAMES: Record<GapValue, string> = {
    0: 'gap-x-0',
    1: 'gap-x-1',
    2: 'gap-x-2',
    3: 'gap-x-3',
    4: 'gap-x-4',
    6: 'gap-x-6',
    8: 'gap-x-8',
};

const GAP_Y_CLASS_NAMES: Record<GapValue, string> = {
    0: 'gap-y-0',
    1: 'gap-y-1',
    2: 'gap-y-2',
    3: 'gap-y-3',
    4: 'gap-y-4',
    6: 'gap-y-6',
    8: 'gap-y-8',
};

const FLOW_CLASS_NAMES: Record<FlowValue, string> = {
    row: 'grid-flow-row',
    col: 'grid-flow-col',
};

export const Grid = <T extends GridElement = 'div'>({
    as,
    cols = 1,
    gap,
    gapX,
    gapY,
    flow,
    className,
    children,
    ...props
}: GridProps<T>): ReactElement => {
    const Component = as ?? 'div';
    return (
        <Component
            className={cn(
                'grid',
                COLS_CLASS_NAMES[cols],
                gap !== undefined && GAP_CLASS_NAMES[gap],
                gapX !== undefined && GAP_X_CLASS_NAMES[gapX],
                gapY !== undefined && GAP_Y_CLASS_NAMES[gapY],
                flow !== undefined && FLOW_CLASS_NAMES[flow],
                className
            )}
            {...props}
        >
            {children}
        </Component>
    );
};
