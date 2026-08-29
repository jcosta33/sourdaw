type NativeDenoiseResult = {
    samples: Float32Array;
    noise_floor_db: number;
    processing_time_ms: number;
};

export type DenoiseResult = {
    samples: Float32Array;
    noise_floor_db: number;
    processing_time_ms: number;
};

export function toDenoiseResult(result: NativeDenoiseResult): DenoiseResult {
    return {
        samples: new Float32Array(result.samples),
        noise_floor_db: result.noise_floor_db,
        processing_time_ms: result.processing_time_ms,
    };
}
