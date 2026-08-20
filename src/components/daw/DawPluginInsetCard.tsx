import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { DawPluginSectionHeader } from './DawPluginSectionHeader';

type DawPluginInsetCardProps = HTMLAttributes<HTMLDivElement> & {
    title: ReactNode;
    actions?: ReactNode;
    titleClassName?: string;
    headerSize?: 'sm' | 'xs';
    children: ReactNode;
};

export const DawPluginInsetCard = ({
    title,
    actions,
    titleClassName,
    headerSize = 'sm',
    className,
    children,
    ...props
}: DawPluginInsetCardProps): ReactElement => (
    <Stack gap={2} className={cn('px-3 py-2', className)} {...props}>
        <DawPluginSectionHeader title={title} actions={actions} titleClassName={titleClassName} size={headerSize} />
        {children}
    </Stack>
);
