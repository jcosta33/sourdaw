import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';
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
    <div className={cn('flex flex-col gap-2 px-3 py-2', className)} {...props}>
        <DawPluginSectionHeader title={title} actions={actions} titleClassName={titleClassName} size={headerSize} />
        {children}
    </div>
);
