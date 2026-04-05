import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/helpers/Styles/cn';

type DawPluginRailProps = HTMLAttributes<HTMLElement> & {
    scrollable?: boolean;
    as?: 'aside' | 'div';
};

export const DawPluginRail = ({
    scrollable = true,
    as = 'aside',
    className,
    children,
    ...props
}: DawPluginRailProps): ReactElement => {
    const Component = as;

    return (
        <Component
            className={cn('flex min-h-0 flex-col gap-3', scrollable ? 'overflow-y-auto pr-1' : '', className)}
            {...props}
        >
            {children}
        </Component>
    );
};
