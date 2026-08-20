import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawSectionDividerProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    startSlot?: ReactNode;
    labelClassName?: string;
    lineClassName?: string;
};

export const DawSectionDivider = ({
    label,
    startSlot,
    labelClassName,
    lineClassName,
    className,
    ...props
}: DawSectionDividerProps): ReactElement => (
    <Row gap={1.5} className={className} {...props}>
        {startSlot}
        <span
            className={cn(
                'text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60',
                labelClassName
            )}
        >
            {label}
        </span>
        <div className={cn('h-px flex-1 bg-border/20', lineClassName)} />
    </Row>
);
