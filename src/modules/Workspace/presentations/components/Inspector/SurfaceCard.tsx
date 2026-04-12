import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type SurfaceCardProps = HTMLAttributes<HTMLDivElement>;

export const SurfaceCard = ({ className, children, ...props }: SurfaceCardProps): ReactElement => (
    <div className={cn('rounded-md border border-border/50 bg-surface-base p-2 shadow-none', className)} {...props}>
        {children}
    </div>
);
