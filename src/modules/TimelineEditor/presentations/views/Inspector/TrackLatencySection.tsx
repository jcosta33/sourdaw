import { type ReactElement } from 'react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Stack } from '#/components/layout';
import { getTrackLatency, getCompensationDelay } from '#/modules/AudioEngine/useCases';

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
                <Stack gap={1} className="px-1">
                    <DawReadoutRow
                        label="Device chain"
                        value={`${latency.deviceLatencyMs.toFixed(2)} ms`}
                        valueClassName="text-foreground/70"
                    />
                    {compensationMs > 0 ? (
                        <DawReadoutRow
                            label="PDC delay"
                            value={`+${compensationMs.toFixed(2)} ms`}
                            valueClassName="text-foreground/70"
                        />
                    ) : null}
                </Stack>
            ) : (
                <DawEmptyState compact className="mx-1" title="No latency reported" />
            )}
        </div>
    );
};
