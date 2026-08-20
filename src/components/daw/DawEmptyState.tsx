import { type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
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
    <Stack
        align="center"
        justify="center"
        gap={compact ? 1.5 : 2}
        className={cn('daw-empty-state-surface rounded-md text-center', compact ? 'p-4' : 'p-5', className)}
    >
        {icon !== undefined ? <div className="text-muted-foreground/55">{icon}</div> : null}
        <Stack gap={1}>
            <p className={cn('font-medium text-foreground/92', compact ? 'text-xs' : 'text-sm')}>{title}</p>
            {description !== undefined ? (
                <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>
                    {description}
                </p>
            ) : null}
        </Stack>
        {action}
    </Stack>
);
