import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row, Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPickerCardProps = HTMLAttributes<HTMLDivElement> & {
    media?: ReactNode;
    heading: ReactNode;
    description?: ReactNode;
    meta?: ReactNode;
    action?: ReactNode;
    bodyClassName?: string;
};

export const DawPickerCard = ({
    media,
    heading,
    description,
    meta,
    action,
    className,
    bodyClassName,
    children,
    ...props
}: DawPickerCardProps): ReactElement => (
    <div
        className={cn(
            'group overflow-hidden rounded-lg border border-white/8 bg-white/[0.03] transition-all duration-200 hover:border-white/14 hover:bg-white/[0.045]',
            className
        )}
        {...props}
    >
        {media ? <div className="border-b border-white/[0.06] bg-black/[0.16]">{media}</div> : null}
        <Stack gap={1.5} className={cn('p-2', bodyClassName)}>
            <Row justify="between" gap={2}>
                <div className="min-w-0 text-[11px] font-medium leading-none text-foreground/90">{heading}</div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </Row>
            {meta ? <div>{meta}</div> : null}
            {description ? (
                <div className="text-[9px] leading-tight text-muted-foreground/60">{description}</div>
            ) : null}
            {children}
        </Stack>
    </div>
);
