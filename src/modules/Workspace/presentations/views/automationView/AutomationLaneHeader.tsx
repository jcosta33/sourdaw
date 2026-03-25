/**
 * Lane header strip — parameter name badge, current value, mode indicators.
 */
import { type ReactElement } from 'react';
import { formatParameterValue } from '../../helpers/automationLaneConstants';

type AutomationLaneHeaderProps = {
    parameterName: string;
    parameterId: string;
    curveColor: string;
    currentValue: number | null;
    isDrawMode: boolean;
    isVirginTerritory: boolean;
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
    isVirginTerritory,
    isYZoomed,
    viewMin,
    viewMax,
}: AutomationLaneHeaderProps): ReactElement => (
    <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5">
        <div className="size-2 rounded-full" style={{ backgroundColor: curveColor }} />
        <span className="text-[9px] font-medium text-muted-foreground bg-surface-base/90 px-1.5 py-0.5 rounded backdrop-blur-sm">
            {parameterName}
        </span>
        {currentValue !== null ? (
            <span className="text-[9px] font-mono text-foreground/60 bg-surface-base/80 px-1 py-0.5 rounded">
                {formatParameterValue(currentValue, parameterId)}
            </span>
        ) : null}
        {isDrawMode ? (
            <span className="text-[9px] font-mono text-[var(--color-accent-peach)]/80 bg-[var(--color-accent-peach)]/10 px-1 py-0.5 rounded">
                DRAW
            </span>
        ) : null}
        {isVirginTerritory ? (
            <span className="text-[9px] font-mono text-[var(--color-state-success)]/80 bg-[var(--color-state-success)]/10 px-1 py-0.5 rounded">
                VT
            </span>
        ) : null}
        {isYZoomed ? (
            <span className="text-[9px] font-mono text-[var(--color-accent-cyan)]/80 bg-[var(--color-accent-cyan)]/10 px-1 py-0.5 rounded">
                Y:{(viewMin * 100).toFixed(0)}–{(viewMax * 100).toFixed(0)}%
            </span>
        ) : null}
    </div>
);
