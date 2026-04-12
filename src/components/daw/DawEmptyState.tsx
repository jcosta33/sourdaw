import { type ReactElement, type ReactNode } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawEmptyStateProps = {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    className?: string;
    compact?: boolean;
};

export const DawEmptyState = ({
    title,
    description,
    icon,
    action,
    className,
    compact = false,
}: DawEmptyStateProps): ReactElement => (
    <div
        className={cn(
            'daw-empty-state-surface flex flex-col items-center justify-center rounded-md text-center',
            compact ? 'gap-1.5 p-4' : 'gap-2 p-5',
            className
        )}
    >
        {icon !== undefined ? <div className="text-muted-foreground/55">{icon}</div> : null}
        <div className="space-y-1">
            <p className={cn('font-medium text-foreground/92', compact ? 'text-xs' : 'text-sm')}>{title}</p>
            {description !== undefined ? (
                <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>
                    {description}
                </p>
            ) : null}
        </div>
        {action}
    </div>
);
