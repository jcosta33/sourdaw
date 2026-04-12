import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/utils/Styles/cn';
import { DawMeterBar } from './DawMeterBar';
import { DawReadoutRow } from './DawReadoutRow';

type DawUtilityMetricProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value: ReactNode;
    startSlot?: ReactNode;
    meterValue?: number;
    meterFillClassName?: string;
    valueClassName?: string;
    children?: ReactNode;
};

export const DawUtilityMetric = ({
    label,
    value,
    startSlot,
    meterValue,
    meterFillClassName,
    valueClassName,
    className,
    children,
    ...props
}: DawUtilityMetricProps): ReactElement => (
    <div className={cn('space-y-0.5', className)} {...props}>
        <div className="flex items-start gap-2">
            {startSlot}
            <div className="min-w-0 flex-1 space-y-0.5">
                <DawReadoutRow label={label} value={value} valueClassName={valueClassName} />
                {children}
            </div>
        </div>
        {meterValue !== undefined ? (
            <DawMeterBar
                size="sm"
                className="w-full bg-surface-overlay shadow-none"
                fillClassName={cn('h-full rounded-full transition-all', meterFillClassName)}
                value={meterValue}
            />
        ) : null}
    </div>
);
