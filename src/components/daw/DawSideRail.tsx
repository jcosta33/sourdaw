import { type HTMLAttributes, type ReactElement } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawSideRailProps = HTMLAttributes<HTMLDivElement>;

export const DawSideRail = ({ className, children, ...props }: DawSideRailProps): ReactElement => (
    <Stack shrink={false} className={cn('daw-side-rail min-w-0', className)} {...props}>
        {children}
    </Stack>
);
