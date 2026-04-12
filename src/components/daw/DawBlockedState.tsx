import { type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';
import { DawEyebrowLabel } from './DawEyebrowLabel';

type DawBlockedStateProps = {
    title: ReactNode;
    description?: ReactNode;
    eyebrow?: ReactNode;
    icon?: ReactNode;
    summary?: ReactNode;
    action?: ReactNode;
    className?: string;
    compact?: boolean;
};

export const DawBlockedState = ({
    title,
    description,
    eyebrow,
    icon,
    summary,
    action,
    className,
    compact = false,
}: DawBlockedStateProps): ReactElement => (
    <div
        className={cn(
            'daw-empty-state-surface flex flex-col items-center justify-center rounded-md text-center',
            compact ? 'gap-2 p-4' : 'gap-3 p-5',
            className
        )}
    >
        {eyebrow ? (
            <DawEyebrowLabel size="sm" className="text-muted-foreground/70">
                {eyebrow}
            </DawEyebrowLabel>
        ) : null}
        {icon !== undefined ? <div className="text-muted-foreground/55">{icon}</div> : null}
        <div className="space-y-1">
            <p className={cn('font-medium text-foreground/92', compact ? 'text-xs' : 'text-sm')}>{title}</p>
            {description !== undefined ? (
                <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>
                    {description}
                </p>
            ) : null}
        </div>
        {summary ? (
            <div
                className={cn(
                    'max-w-full rounded-md border border-white/7 bg-black/18 text-muted-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                    compact ? 'px-2.5 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'
                )}
            >
                {summary}
            </div>
        ) : null}
        {action}
    </div>
);
