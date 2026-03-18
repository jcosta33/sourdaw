import { type ReactElement, useSyncExternalStore } from 'react';
import { audioGraphStore } from '#/modules/AudioEngine/stores/audioGraphStore';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackRoutingSectionProps = {
    track: Track;
};

export const TrackRoutingSection = ({ track }: TrackRoutingSectionProps): ReactElement => {
    const graphState = useSyncExternalStore(
        (cb) => audioGraphStore.subscribe(cb),
        () => audioGraphStore.value
    );

    const trackRoutes = graphState?.routes.filter((r) => r.sourceId === track.id || r.destinationId === track.id) ?? [];

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Routing</h3>
            {trackRoutes.length > 0 ? (
                <div className="space-y-1">
                    {trackRoutes.map((route) => (
                        <div
                            key={route.id}
                            className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1"
                        >
                            <span className="text-[10px] text-muted-foreground">
                                {route.sourceId === track.id ? `→ ${route.destinationId}` : `← ${route.sourceId}`}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                                {(route.gain * 100).toFixed(0)}%
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground">Default routing to master.</p>
            )}
        </section>
    );
};
