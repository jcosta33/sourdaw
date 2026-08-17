import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

type AnalyzeNativePitchInput = {
    analysisId: string;
    audioPath: string;
};

type NativePitchPoint = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};

type NativePitchContour = {
    points: NativePitchPoint[];
    sample_rate: number;
    hop_size: number;
    algorithm: string;
};

type AnalyzeNativePitchOutput = Promise<NativePitchContour | null>;

function isNativePitchPoint(value: unknown): value is NativePitchPoint {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return (
        'time_ms' in value &&
        Number.isFinite(value.time_ms) &&
        'frequency_hz' in value &&
        Number.isFinite(value.frequency_hz) &&
        'confidence' in value &&
        Number.isFinite(value.confidence) &&
        'voiced' in value &&
        typeof value.voiced === 'boolean'
    );
}

function isNativePitchContour(value: unknown): value is NativePitchContour {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return (
        'points' in value &&
        Array.isArray(value.points) &&
        value.points.every(isNativePitchPoint) &&
        'sample_rate' in value &&
        Number.isFinite(value.sample_rate) &&
        'hop_size' in value &&
        Number.isFinite(value.hop_size) &&
        'algorithm' in value &&
        typeof value.algorithm === 'string'
    );
}

export async function analyzeNativePitch({ analysisId, audioPath }: AnalyzeNativePitchInput): AnalyzeNativePitchOutput {
    if (!isTauri()) {
        return null;
    }

    const result = await tauriInvoke('analyze_pitch', { analysisId, audioPath });

    if (!isNativePitchContour(result)) {
        throw new TypeError('analyze_pitch returned an invalid payload');
    }

    return result;
}
