export type DenoiseResult = {
    samples: number[];
    noise_floor_db: number;
    processing_time_ms: number;
};