import { type ReactElement, useSyncExternalStore } from 'react';
import { Card } from '#/components/ui/card';
import { audioGraphStore } from '#/modules/AudioEngine/stores/audioGraphStore';
import { type Track } from '#/modules/Arrangement/models/Track';

type TrackRoutingSectionProps = {
    track: Track;
};

export const TrackRoutingSection = ({ track }: TrackRoutingSectionProps): ReactElement => {
    const graphState = useSyncExternalStore(
        (cb) => audioGraphStore.subscribe(cb),
        () => audioGraphStore.value
    );

    const trackRoutes = graphState?.routes.filter((r) => r.sourceId === track.id || r.destinationId === track.id) ?? [];

    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Routing
            </div>
            {trackRoutes.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {trackRoutes.map((route) => (
                        <Card
                            key={route.id}
                            className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex items-center justify-between"
                        >
                            <span className="text-[10px] text-muted-foreground">
                                {route.sourceId === track.id ? `→ ${route.destinationId}` : `← ${route.sourceId}`}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                                {(route.gain * 100).toFixed(0)}%
                            </span>
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground px-1">Default routing to master.</p>
            )}
        </div>
    );
};
