import { type HTMLAttributes, type ReactElement } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawDialogBodyProps = HTMLAttributes<HTMLDivElement> & {
    scrollable?: boolean;
};

export const DawDialogBody = ({
    className,
    scrollable = false,
    children,
    ...props
}: DawDialogBodyProps): ReactElement => (
    <Stack
        gap={4}
        className={cn('bg-surface-base/40 px-4 py-4', scrollable ? 'overflow-y-auto' : '', className)}
        {...props}
    >
        {children}
    </Stack>
);
