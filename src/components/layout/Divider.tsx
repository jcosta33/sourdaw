import { type ReactElement, type ComponentPropsWithoutRef } from 'react';

import { cn } from '#/utils/Styles/cn';

type DividerSpacing = 0 | 2 | 3 | 4;
type DividerTone = 'subtle' | 'default' | 'strong';
type DividerAxis = 'x' | 'y';

type DividerProps = ComponentPropsWithoutRef<'div'> & {
    spacing?: DividerSpacing;
    tone?: DividerTone;
    axis?: DividerAxis;
};

const SPACING_CLASS_NAMES: Record<DividerAxis, Record<DividerSpacing, string>> = {
    x: {
        0: 'mx-0',
        2: 'mx-2',
        3: 'mx-3',
        4: 'mx-4',
    },
    y: {
        0: 'my-0',
        2: 'my-2',
        3: 'my-3',
        4: 'my-4',
    },
};

const TONE_CLASS_NAMES: Record<DividerTone, string> = {
    subtle: 'bg-border/20',
    default: 'bg-border/40',
    strong: 'bg-border/60',
};

export const Divider = ({
    spacing = 0,
    tone = 'default',
    axis = 'x',
    className,
    ...props
}: DividerProps): ReactElement => {
    const isHorizontal = axis === 'x';
    return (
        <div
            className={cn(
                'shrink-0',
                isHorizontal ? 'h-px w-full' : 'w-px h-full',
                TONE_CLASS_NAMES[tone],
                SPACING_CLASS_NAMES[axis][spacing],
                className
            )}
            role="separator"
            aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
            {...props}
        />
    );
};
