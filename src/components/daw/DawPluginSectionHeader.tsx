import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawPluginSectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
    title: ReactNode;
    actions?: ReactNode;
    titleClassName?: string;
    size?: 'sm' | 'xs';
};

export const DawPluginSectionHeader = ({
    title,
    actions,
    className,
    titleClassName,
    size = 'sm',
    ...props
}: DawPluginSectionHeaderProps): ReactElement => (
    <div className={cn('flex items-center justify-between gap-2', className)} {...props}>
        <span
            className={cn(
                'uppercase tracking-wider',
                size === 'xs' ? 'text-[8px] font-bold' : 'text-[10px] font-medium',
                titleClassName
            )}
        >
            {title}
        </span>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
);
