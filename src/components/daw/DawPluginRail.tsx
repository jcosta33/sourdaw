import { type HTMLAttributes, type ReactElement } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

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
}: DawPluginRailProps): ReactElement => (
    <Stack as={as} gap={3} className={cn(scrollable ? 'overflow-y-auto pr-1' : '', className)} {...props}>
        {children}
    </Stack>
);
