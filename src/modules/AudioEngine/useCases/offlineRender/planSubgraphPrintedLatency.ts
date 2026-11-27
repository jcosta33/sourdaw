import { type Track } from '#/modules/Arrangement/stores';

import { type captureOfflineSubgraphInput } from './captureOfflineSubgraphInput';
import { planPrintedLatencyFrames } from './planPrintedLatencyFrames';
import { unprintedDeviceTypes } from './unprintedDeviceTypes';

type PlanSubgraphPrintedLatencyInput = Readonly<{
    cropPrintedLatency: boolean | undefined;
    targetTrackId: string;
    renderTracks: readonly Track[];
    includeInserts: boolean;
    /** The render's captured inputs; absent reads the live latencies. */
    captured: ReturnType<typeof captureOfflineSubgraphInput> | null;
    sampleRate: number;
    baseFrameCount: number;
    onWarning?: (message: string) => void;
}>;

/**
 * The frames a subgraph render adds and crops from its head so its print lands on the timeline:
 * none unless the caller asks for the crop, else the target's printed shift, which leaves out the
 * devices the print does not carry.
 */
export function planSubgraphPrintedLatency({
    cropPrintedLatency,
    targetTrackId,
    renderTracks,
    includeInserts,
    captured,
    sampleRate,
    baseFrameCount,
    onWarning,
}: PlanSubgraphPrintedLatencyInput): number {
    if (cropPrintedLatency !== true) {
        return 0;
    }
    const targetDevices = renderTracks.find((track) => track.id === targetTrackId)?.devices ?? [];
    return planPrintedLatencyFrames({
        trackId: targetTrackId,
        latency: captured?.scheduling.latency,
        unprintedDeviceTypes: unprintedDeviceTypes(targetDevices, includeInserts),
        sampleRate,
        baseFrameCount,
        onWarning,
    });
}
