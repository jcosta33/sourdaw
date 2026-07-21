import { type ReactElement, type ComponentProps } from 'react';

import { cn } from '#/utils/Styles/cn';

type SpacerSize = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16;
type SpacerAxis = 'x' | 'y';

type SpacerProps = ComponentProps<'div'> & {
    size: SpacerSize;
    axis?: SpacerAxis;
};

const SIZE_CLASS_NAMES: Record<SpacerAxis | 'both', Record<SpacerSize, string>> = {
    both: {
        0: 'w-0 h-0',
        1: 'w-1 h-1',
        2: 'w-2 h-2',
        3: 'w-3 h-3',
        4: 'w-4 h-4',
        6: 'w-6 h-6',
        8: 'w-8 h-8',
        12: 'w-12 h-12',
        16: 'w-16 h-16',
    },
    x: {
        0: 'w-0',
        1: 'w-1',
        2: 'w-2',
        3: 'w-3',
        4: 'w-4',
        6: 'w-6',
        8: 'w-8',
        12: 'w-12',
        16: 'w-16',
    },
    y: {
        0: 'h-0',
        1: 'h-1',
        2: 'h-2',
        3: 'h-3',
        4: 'h-4',
        6: 'h-6',
        8: 'h-8',
        12: 'h-12',
        16: 'h-16',
    },
};

export const Spacer = ({ size, axis, className, ...props }: SpacerProps): ReactElement => {
    const direction = axis ?? 'both';
    return (
        <div className={cn('shrink-0', SIZE_CLASS_NAMES[direction][size], className)} aria-hidden="true" {...props} />
    );
};
