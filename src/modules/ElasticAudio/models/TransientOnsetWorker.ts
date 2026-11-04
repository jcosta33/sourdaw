export type TransientOnsetWorkerRequest = {
    channels: Float32Array[];
    sampleRate: number;
    sensitivity: number;
};

export type TransientOnsetWorkerResult =
    | { status: 'complete'; hits: readonly { sampleOffset: number; confidence: number }[] }
    | { status: 'failed'; code: 'cancelled' | 'analysis-timed-out' | 'analysis-failed' };
