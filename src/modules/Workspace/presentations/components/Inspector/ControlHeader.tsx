import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type ControlHeaderProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value?: ReactNode;
    labelClassName?: string;
    valueClassName?: string;
};

export const ControlHeader = ({
    label,
    value,
    className,
    labelClassName,
    valueClassName,
    ...props
}: ControlHeaderProps): ReactElement => (
    <div className={cn('flex items-center justify-between gap-2', className)} {...props}>
        <label className={cn('text-[10px] text-muted-foreground', labelClassName)}>{label}</label>
        {value !== undefined ? (
            <div className={cn('text-[10px] font-mono text-muted-foreground', valueClassName)}>{value}</div>
        ) : null}
    </div>
);
