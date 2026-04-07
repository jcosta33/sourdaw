import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type AutomationSidebarCellProps = HTMLAttributes<HTMLDivElement> & {
    children: ReactNode;
};

export const AutomationSidebarCell = ({
    className,
    children,
    ...props
}: AutomationSidebarCellProps): ReactElement => (
    <div className={cn('min-w-0 border-r border-border/30 bg-surface-well', className)} {...props}>
        {children}
    </div>
);
