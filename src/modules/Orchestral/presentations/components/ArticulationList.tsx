/**
 * ArticulationList — visual grid of articulation cards.
 *
 * Level 2: full-width grid for quick switching.
 * Level 3+: compact sidebar list.
 */
import { type ReactElement } from 'react';
import { type ArticulationEntry, type ArticulationType } from '../../models/OrchestraPatch';
import { setCurrentArticulation } from '../../stores/orchestralStore';

type ArticulationListProps = {
    articulations: ArticulationEntry[];
    current: ArticulationType;
    grid?: boolean;
};

const midiNoteToName = (note: number): string => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    return `${names[note % 12]}${octave}`;
};

export const ArticulationList = ({
    articulations,
    current,
    grid,
}: ArticulationListProps): ReactElement => {
    const enabled = articulations.filter((a) => a.enabled);

    if (grid) {
        return (
            <div className="grid grid-cols-3 gap-1.5 p-2">
                {enabled.map((art) => {
                    const isActive = art.type === current;
                    return (
                        <button
                            key={art.type}
                            type="button"
                            className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border transition-all ${
                                isActive
                                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.1)]'
                                    : 'bg-surface-raised/30 border-border/20 text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground'
                            }`}
                            onClick={() => setCurrentArticulation(art.type)}
                        >
                            <span className="text-[10px] font-medium leading-tight">{art.name}</span>
                            {art.keyswitch !== null ? (
                                <span className="text-[7px] text-muted-foreground/50 tabular-nums">
                                    {midiNoteToName(art.keyswitch)}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        );
    }

    // Compact sidebar list
    return (
        <div className="flex flex-col gap-0 p-1">
            <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                Articulations
            </span>
            {enabled.map((art) => {
                const isActive = art.type === current;
                return (
                    <button
                        key={art.type}
                        type="button"
                        className={`flex items-center justify-between px-2 py-1 rounded text-[10px] transition-colors ${
                            isActive
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'text-muted-foreground hover:bg-surface-raised/40 hover:text-foreground'
                        }`}
                        onClick={() => setCurrentArticulation(art.type)}
                    >
                        <span>{art.name}</span>
                        {art.keyswitch !== null ? (
                            <span className="text-[8px] text-muted-foreground/40 tabular-nums">
                                {midiNoteToName(art.keyswitch)}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
};
