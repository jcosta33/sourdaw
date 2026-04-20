import { type ReactElement } from 'react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { useStore } from '#/infra/store/useStore';
import { audioGraphStore, defaultAudioGraphState } from '#/modules/AudioEngine/stores';

import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type RoutingGraphState = {
    routes: Array<{
        id: string;
        sourceId: string;
        destinationId: string;
        gain: number;
    }>;
};

type TrackRoutingSectionProps = {
    track: Track;
};

export const TrackRoutingSection = ({ track }: TrackRoutingSectionProps): ReactElement => {
    const graphState = useStore<RoutingGraphState>(audioGraphStore, defaultAudioGraphState);

    const trackRoutes = graphState.routes.filter((r) => r.sourceId === track.id || r.destinationId === track.id);

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Routing" />
            {trackRoutes.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {trackRoutes.map((route) => (
                        <SurfaceCard key={route.id}>
                            <DawReadoutRow
                                label={route.sourceId === track.id ? `→ ${route.destinationId}` : `← ${route.sourceId}`}
                                value={`${(route.gain * 100).toFixed(0)}%`}
                            />
                        </SurfaceCard>
                    ))}
                </div>
            ) : (
                <DawEmptyState
                    compact
                    className="mx-1"
                    title="Default routing to master"
                    description="No custom sends or route overrides are active for this track."
                />
            )}
        </div>
    );
};
