/**
 * ArticulationList — visual grid of articulation cards.
 *
 * Level 2: full-width grid for quick switching.
 * Level 3+: compact sidebar list.
 */
import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { Grid, Stack } from '#/components/layout';

import { type ArticulationEntry, type ArticulationType } from '../../models/LevainPatch';

type ArticulationListProps = {
    articulations: ArticulationEntry[];
    current: ArticulationType;
    grid?: boolean;
    onSelect: (type: ArticulationType) => void;
};

const midiNoteToName = (note: number): string => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    return `${names[note % 12]}${octave}`;
};

export const ArticulationList = ({ articulations, current, grid, onSelect }: ArticulationListProps): ReactElement => {
    const enabled = articulations.filter((a) => a.enabled);

    if (grid) {
        return (
            <Grid cols={3} gap={1.5} className="p-2">
                {enabled.map((art) => {
                    const isActive = art.type === current;
                    return (
                        <DawPluginChip
                            key={art.type}
                            active={isActive}
                            tone="amber"
                            caps={false}
                            shape="soft"
                            className="flex flex-col gap-0.5 px-2 py-2"
                            onClick={() => onSelect(art.type)}
                        >
                            <span className="text-[10px] font-medium leading-tight">{art.name}</span>
                            {art.keyswitch !== null ? (
                                <span className="text-[7px] text-muted-foreground/50 tabular-nums">
                                    {midiNoteToName(art.keyswitch)}
                                </span>
                            ) : null}
                        </DawPluginChip>
                    );
                })}
            </Grid>
        );
    }

    // Compact sidebar list
    return (
        <Stack className="p-1">
            <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                Articulations
            </span>
            {enabled.map((art) => {
                const isActive = art.type === current;
                return (
                    <DawPluginChip
                        key={art.type}
                        active={isActive}
                        tone="amber"
                        caps={false}
                        className="flex w-full items-center justify-between px-2 py-1 text-[10px]"
                        onClick={() => onSelect(art.type)}
                    >
                        <span>{art.name}</span>
                        {art.keyswitch !== null ? (
                            <span className="text-[8px] text-muted-foreground/40 tabular-nums">
                                {midiNoteToName(art.keyswitch)}
                            </span>
                        ) : null}
                    </DawPluginChip>
                );
            })}
        </Stack>
    );
};
