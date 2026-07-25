/**
 * Lane header strip — parameter name badge, current value, mode indicators.
 */
import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';

import { formatParameterValue } from '../../helpers/automationLaneConstants';

type AutomationLaneHeaderProps = {
    parameterName: string;
    parameterId: string;
    curveColor: string;
    currentValue: number | null;
    isDrawMode: boolean;
    isYZoomed: boolean;
    viewMin: number;
    viewMax: number;
};

export const AutomationLaneHeader = ({
    parameterName,
    parameterId,
    curveColor,
    currentValue,
    isDrawMode,
    isYZoomed,
    viewMin,
    viewMax,
}: AutomationLaneHeaderProps): ReactElement => (
    <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5">
        <div className="size-2 rounded-full" style={{ backgroundColor: curveColor }} />
        <DawMicroBadge className="border-border/20 bg-surface-base/90 text-muted-foreground backdrop-blur-sm">
            {parameterName}
        </DawMicroBadge>
        {currentValue !== null ? (
            <DawMicroBadge className="border-border/20 bg-surface-base/80 font-mono text-foreground/60">
                {formatParameterValue(currentValue, parameterId)}
            </DawMicroBadge>
        ) : null}
        {isDrawMode ? (
            <DawMicroBadge tone="peach" className="font-mono text-[var(--color-accent-peach)]/80">
                DRAW
            </DawMicroBadge>
        ) : null}
        {isYZoomed ? (
            <DawMicroBadge tone="cyan" className="font-mono text-[var(--color-accent-cyan)]/80">
                Y:{(viewMin * 100).toFixed(0)}–{(viewMax * 100).toFixed(0)}%
            </DawMicroBadge>
        ) : null}
    </div>
);
