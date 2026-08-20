import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawReadoutRowProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value: ReactNode;
    labelClassName?: string;
    valueClassName?: string;
};

export const DawReadoutRow = ({
    label,
    value,
    className,
    labelClassName,
    valueClassName,
    ...props
}: DawReadoutRowProps): ReactElement => (
    <Row justify="between" gap={3} className={className} {...props}>
        <span className={cn('text-[10px] text-muted-foreground', labelClassName)}>{label}</span>
        <span className={cn('text-[10px] font-mono text-muted-foreground', valueClassName)}>{value}</span>
    </Row>
);
