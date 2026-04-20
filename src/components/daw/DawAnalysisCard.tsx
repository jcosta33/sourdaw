import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawAnalysisCardProps = HTMLAttributes<HTMLDivElement> & {
    title: ReactNode;
    detail?: ReactNode;
    footer?: ReactNode;
    bodyClassName?: string;
};

export const DawAnalysisCard = ({
    title,
    detail,
    footer,
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
            {detail ? <div className="mt-0.5 text-[9px] text-muted-foreground/65">{detail}</div> : null}
        </div>
        <div className={cn('flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden', bodyClassName)}>
            {children}
        </div>
        {footer ? <div className="border-t border-white/6 px-2.5 py-1">{footer}</div> : null}
    </div>
);
