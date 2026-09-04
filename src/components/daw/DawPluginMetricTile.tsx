import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPluginMetricTileProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value: ReactNode;
    detail?: ReactNode;
    compact?: boolean;
    labelClassName?: string;
    valueClassName?: string;
    detailClassName?: string;
};

export const DawPluginMetricTile = ({
    label,
    value,
    detail,
    compact = false,
    className,
    labelClassName,
    valueClassName,
    detailClassName,
    ...props
}: DawPluginMetricTileProps): ReactElement => (
    <Stack
        gap={compact ? 0.5 : 1}
        className={cn(compact ? 'min-w-0 px-2 py-0.5' : 'min-w-[96px] px-3 py-2', className)}
        {...props}
    >
        <span
            className={cn(
                compact ? 'text-[7px] tracking-[0.2em]' : 'text-[8px] tracking-[0.24em]',
                'uppercase text-muted-foreground/55',
                labelClassName
            )}
        >
            {label}
        </span>
        <span
            className={cn(
                'font-mono text-foreground',
                compact ? 'text-[11px] leading-tight' : 'text-[13px]',
                valueClassName
            )}
        >
            {value}
        </span>
        {detail ? (
            <span
                className={cn(
                    'text-muted-foreground/55',
                    compact ? 'text-[8px] leading-tight' : 'text-[9px] leading-4',
                    detailClassName
                )}
            >
                {detail}
            </span>
        ) : null}
    </Stack>
);
