/**
 * Stereo output level meter for Fermenter.
 * Renders L/R peak levels as vertical bars.
 */
import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';

import { useFermenterPeaks } from '../hooks/useFermenterTelemetry';

type OutputMeterProps = {
    deviceId: string;
    height?: number;
};

export const OutputMeter = ({ deviceId, height = 48 }: OutputMeterProps): ReactElement => {
    const { peakL, peakR } = useFermenterPeaks(deviceId);

    const toDb = (v: number): number => {
        if (v < 0.0001) {
            return -60;
        }
        return 20 * Math.log10(v);
    };

    const dbToPercent = (db: number): number => {
        const min = -60;
        const max = 6;
        return Math.max(0, Math.min(1, (db - min) / (max - min)));
    };

    const lDb = toDb(peakL);
    const rDb = toDb(peakR);
    const lPct = dbToPercent(lDb);
    const rPct = dbToPercent(rDb);

    const barColor = (pct: number): string => {
        if (pct > 0.9) {
            return 'var(--color-state-danger)';
        }
        if (pct > 0.7) {
            return 'var(--color-accent-peach)';
        }
        return 'var(--color-accent-mint)';
    };

    return (
        <Row align="end" gap={0.5} style={{ height }}>
            {/* L */}
            <Stack align="center" gap={0.5}>
                <div
                    className="w-1.5 rounded-sm transition-all duration-75"
                    style={{
                        height: `${Math.max(1, lPct * height)}px`,
                        backgroundColor: barColor(lPct),
                        opacity: lPct < 0.01 ? 0.2 : 1,
                    }}
                />
                <span className="text-[7px] text-muted-foreground/60">L</span>
            </Stack>
            {/* R */}
            <Stack align="center" gap={0.5}>
                <div
                    className="w-1.5 rounded-sm transition-all duration-75"
                    style={{
                        height: `${Math.max(1, rPct * height)}px`,
                        backgroundColor: barColor(rPct),
                        opacity: rPct < 0.01 ? 0.2 : 1,
                    }}
                />
                <span className="text-[7px] text-muted-foreground/60">R</span>
            </Stack>
        </Row>
    );
};
