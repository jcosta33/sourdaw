import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { DawEyebrowLabel } from './DawEyebrowLabel';

type DawUtilitySectionProps = HTMLAttributes<HTMLElement> & {
    title: ReactNode;
    detail?: ReactNode;
    actions?: ReactNode;
    bodyClassName?: string;
};

export const DawUtilitySection = ({
    title,
    detail,
    actions,
    className,
    bodyClassName,
    children,
    ...props
}: DawUtilitySectionProps): ReactElement => (
    <section
        className={cn(
            'rounded-md border border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_-1px_0_rgba(0,0,0,0.22)]',
            className
        )}
        {...props}
    >
        <Row justify="between" gap={2} className="border-b border-white/6 px-2.5 py-2">
            <div className="min-w-0">
                <DawEyebrowLabel size="sm" className="text-foreground/85">
                    {title}
                </DawEyebrowLabel>
                {detail ? <div className="mt-0.5 text-[9px] text-muted-foreground/70">{detail}</div> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
        </Row>
        <div className={cn('px-2.5 py-2', bodyClassName)}>{children}</div>
    </section>
);
