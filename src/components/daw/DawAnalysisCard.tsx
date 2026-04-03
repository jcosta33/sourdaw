import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawAnalysisCardProps = HTMLAttributes<HTMLDivElement> & {
    title: ReactNode;
    bodyClassName?: string;
};

export const DawAnalysisCard = ({
    title,
    className,
    bodyClassName,
    children,
    ...props
}: DawAnalysisCardProps): ReactElement => (
    <div
        className={cn('daw-analysis-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg', className)}
        {...props}
    >
        <div className="daw-analysis-card-header shrink-0 px-2.5 py-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </div>
        <div className={cn('flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden', bodyClassName)}>
            {children}
        </div>
    </div>
);
