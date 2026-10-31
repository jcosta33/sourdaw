import { type ReactElement, type ReactNode, useRef } from 'react';

import { cn } from '#/utils/Styles/cn';

import { useElementWidth } from '../../hooks/useElementWidth';

type FitWidthProps = {
    /** Width used until the container has been measured. */
    fallbackWidth: number;
    className?: string;
    children: (width: number) => ReactNode;
};

/** Gives a fixed-height canvas visualizer the width of the Inspector column it sits in. */
export const FitWidth = ({ fallbackWidth, className, children }: FitWidthProps): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);
    const width = useElementWidth(ref, fallbackWidth);
    return (
        <div ref={ref} className={cn('flex w-full min-w-0 items-stretch justify-center overflow-hidden', className)}>
            {children(width)}
        </div>
    );
};
