export type TempoMapPoint = {
    /** Beat position */
    beat: number;
    /** BPM at this point */
    bpm: number;
    /** Confidence of detection (0–1) */
    confidence: number;
    /** Was this manually adjusted? */
    manual: boolean;
};

export type TempoMapResult = {
    /** Detected tempo map points */
    points: TempoMapPoint[];
    /** Average BPM */
    averageBpm: number;
    /** BPM range */
    minBpm: number;
    maxBpm: number;
    /** Overall confidence */
    confidence: number;
    /** Total beats analyzed */
    totalBeats: number;
};
