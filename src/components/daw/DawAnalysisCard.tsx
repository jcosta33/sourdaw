import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row, Stack } from '#/components/layout';
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
    <Stack className={cn('daw-analysis-card min-w-0 overflow-hidden rounded-lg', className)} {...props}>
        <div className="daw-analysis-card-header shrink-0 px-2.5 py-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
            {detail ? <div className="mt-0.5 text-[9px] text-muted-foreground/65">{detail}</div> : null}
        </div>
        <Row grow align="center" justify="center" className={cn('min-h-0 overflow-hidden', bodyClassName)}>
            {children}
        </Row>
        {footer ? <div className="border-t border-white/6 px-2.5 py-1">{footer}</div> : null}
    </Stack>
);
