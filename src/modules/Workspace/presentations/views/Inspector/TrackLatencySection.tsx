import { type ReactElement } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { getTrackLatency, getCompensationDelay } from '#/modules/AudioEngine/useCases/latencyCompensation';

type TrackLatencySectionProps = {
    trackId: string;
};

export const TrackLatencySection = ({ trackId }: TrackLatencySectionProps): ReactElement => {
    const latency = getTrackLatency(trackId);
    const compensation = getCompensationDelay(trackId);
    const compensationMs = compensation * 1000;

    const hasLatency = latency.totalLatencyMs > 0 || compensationMs > 0;

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Latency" />
            {hasLatency ? (
                <div className="flex flex-col gap-1 px-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Device chain</span>
                        <span className="text-[10px] font-mono text-foreground/70">
                            {latency.deviceLatencyMs.toFixed(2)} ms
                        </span>
                    </div>
                    {compensationMs > 0 ? (
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">PDC delay</span>
                            <span className="text-[10px] font-mono text-foreground/70">
                                +{compensationMs.toFixed(2)} ms
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : (
                <DawEmptyState compact className="mx-1" title="No latency reported" />
            )}
        </div>
    );
};
