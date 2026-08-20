import { type HTMLAttributes, type ReactElement } from 'react';

import { Stack } from '#/components/layout';

type DawPluginReadoutListProps = HTMLAttributes<HTMLDivElement> & {
    density?: 'tight' | 'default';
};

export const DawPluginReadoutList = ({
    density = 'default',
    className,
    children,
    ...props
}: DawPluginReadoutListProps): ReactElement => (
    <Stack gap={density === 'tight' ? 1 : 2} className={className} {...props}>
        {children}
    </Stack>
);
