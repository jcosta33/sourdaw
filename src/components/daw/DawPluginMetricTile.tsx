import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPluginMetricTileProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value: ReactNode;
    detail?: ReactNode;
    labelClassName?: string;
    valueClassName?: string;
    detailClassName?: string;
};

export const DawPluginMetricTile = ({
    label,
    value,
    detail,
    className,
    labelClassName,
    valueClassName,
    detailClassName,
    ...props
}: DawPluginMetricTileProps): ReactElement => (
    <Stack gap={1} className={cn('min-w-[96px] px-3 py-2', className)} {...props}>
        <span className={cn('text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55', labelClassName)}>
            {label}
        </span>
        <span className={cn('font-mono text-[13px] text-foreground', valueClassName)}>{value}</span>
        {detail ? (
            <span className={cn('text-[9px] leading-4 text-muted-foreground/55', detailClassName)}>{detail}</span>
        ) : null}
    </Stack>
);
