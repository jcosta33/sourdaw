import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row, Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPluginSectionCardProps = HTMLAttributes<HTMLElement> & {
    title: ReactNode;
    detail?: ReactNode;
    detailMode?: 'hidden' | 'badge';
    titleClassName?: string;
    detailClassName?: string;
    children: ReactNode;
};

export const DawPluginSectionCard = ({
    title,
    detail,
    detailMode = 'hidden',
    className,
    titleClassName,
    detailClassName,
    children,
    ...props
}: DawPluginSectionCardProps): ReactElement => (
    <Stack as="section" gap={3} className={cn('p-3', className)} {...props}>
        {detailMode === 'badge' ? (
            <Row justify="between" gap={2}>
                <div className={cn('text-[8px] font-semibold uppercase tracking-[0.24em]', titleClassName)}>
                    {title}
                </div>
                {detail ? <div className={detailClassName}>{detail}</div> : null}
            </Row>
        ) : (
            <Stack gap={1}>
                <div className={cn('text-[8px] font-semibold uppercase tracking-[0.24em]', titleClassName)}>
                    {title}
                </div>
                {detail ? <span className="sr-only">{detail}</span> : null}
            </Stack>
        )}
        {children}
    </Stack>
);
