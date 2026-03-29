import { type ReactElement } from 'react';
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
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Latency
            </div>
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
                <p className="text-[10px] text-muted-foreground/50 px-1">No latency reported.</p>
            )}
        </div>
    );
};
