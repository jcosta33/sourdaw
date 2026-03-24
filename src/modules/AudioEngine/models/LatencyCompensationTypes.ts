export type TrackLatency = {
    trackId: string;
    deviceLatencyMs: number;
    totalLatencyMs: number;
};

export type LatencyReport = {
    tracks: TrackLatency[];
    maxLatencyMs: number;
    contextBaseLatencyMs: number;
    contextOutputLatencyMs: number;
};
