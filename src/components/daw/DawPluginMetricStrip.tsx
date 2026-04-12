import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawPluginMetricStripProps = HTMLAttributes<HTMLDivElement> & {
    align?: 'start' | 'end';
};

export const DawPluginMetricStrip = ({
    align = 'end',
    className,
    children,
    ...props
}: DawPluginMetricStripProps): ReactElement => (
    <div
        className={cn('flex flex-wrap gap-2', align === 'end' ? 'justify-end' : 'justify-start', className)}
        {...props}
    >
        {children}
    </div>
);
