import { type ReactElement } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';

import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';
import { useTracks } from '../../hooks/useTracks';

type TrackRoutingSectionProps = {
    track: Track;
};

type TrackRouting = {
    outputLabel: string;
    inputNames: string[];
};

const MASTER_OUTPUT_ID = 'master';
const HARDWARE_OUTPUT_ID = 'hw_out';

const resolveOutputLabel = (outputId: string, tracks: Track[]): string => {
    if (outputId === MASTER_OUTPUT_ID) return 'Master';
    if (outputId === HARDWARE_OUTPUT_ID) return 'Hardware output';
    return tracks.find((candidate) => candidate.id === outputId)?.name ?? 'Unknown destination';
};

export const deriveTrackRouting = (track: Track, tracks: Track[]): TrackRouting => {
    const receivesId = track.kind === 'master' ? MASTER_OUTPUT_ID : track.id;
    const inputNames =
        track.kind === 'master' || track.kind === 'bus'
            ? tracks
                  .filter((candidate) => candidate.id !== track.id && candidate.outputId === receivesId)
                  .map((candidate) => candidate.name)
            : [];

    return { outputLabel: resolveOutputLabel(track.outputId, tracks), inputNames };
};

export const TrackRoutingSection = ({ track }: TrackRoutingSectionProps): ReactElement => {
    const { tracks } = useTracks();
    const { outputLabel, inputNames } = deriveTrackRouting(track, tracks);

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Routing" />
            <SurfaceCard>
                <DawReadoutRow label="Output" value={outputLabel} />
                {inputNames.length > 0 && (
                    <DawReadoutRow label={inputNames.length === 1 ? 'Input' : 'Inputs'} value={inputNames.join(', ')} />
                )}
            </SurfaceCard>
        </div>
    );
};
