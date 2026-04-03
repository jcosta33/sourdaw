import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

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
    <div className={cn('flex items-center justify-between gap-3', className)} {...props}>
        <span className={cn('text-[10px] text-muted-foreground', labelClassName)}>{label}</span>
        <span className={cn('text-[10px] font-mono text-muted-foreground', valueClassName)}>{value}</span>
    </div>
);
