/**
 * ArticulationIndicator — hero display for the currently active articulation.
 * Large, bold, unmissable — this is the #1 piece of information for an
 * levain composer. Used as the center hero at Level 1.
 */
import { type ReactElement } from 'react';

type ArticulationIndicatorProps = {
    articulationName: string;
    instrumentName: string;
};

export const ArticulationIndicator = ({
    articulationName,
    instrumentName,
}: ArticulationIndicatorProps): ReactElement => (
    <div className="flex flex-col items-center justify-center gap-1 py-6">
        <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
            <span className="text-2xl font-bold text-foreground tracking-tight">
                {articulationName}
            </span>
        </div>
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
            {instrumentName.replace(/-/g, ' ')}
        </span>
    </div>
);
