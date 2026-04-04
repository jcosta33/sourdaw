import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/helpers/Styles/cn';

type DawPluginReadoutListProps = HTMLAttributes<HTMLDivElement> & {
    density?: 'tight' | 'default';
};

export const DawPluginReadoutList = ({
    density = 'default',
    className,
    children,
    ...props
}: DawPluginReadoutListProps): ReactElement => (
    <div
        className={cn(density === 'tight' ? 'space-y-1' : 'space-y-2', className)}
        {...props}
    >
        {children}
    </div>
);
