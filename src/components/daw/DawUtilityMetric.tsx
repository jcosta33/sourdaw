import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row, Stack } from '#/components/layout';
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
    <Stack gap={0.5} className={className} {...props}>
        <Row align="start" gap={2}>
            {startSlot}
            <Stack grow gap={0.5} className="min-w-0">
                <DawReadoutRow label={label} value={value} valueClassName={valueClassName} />
                {children}
            </Stack>
        </Row>
        {meterValue !== undefined ? (
            <DawMeterBar
                size="sm"
                className="w-full bg-surface-overlay shadow-none"
                fillClassName={cn('h-full rounded-full transition-all', meterFillClassName)}
                value={meterValue}
            />
        ) : null}
    </Stack>
);
