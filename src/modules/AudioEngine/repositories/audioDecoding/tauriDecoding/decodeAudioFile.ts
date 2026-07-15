import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export type DecodedAudio = {
    samples: number[];
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
};

type RustDecodedAudio = {
    samples: number[];
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return isNonNegativeInteger(value) && value > 0;
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every(isFiniteNumber);
}

function isRustDecodedAudio(value: unknown): value is RustDecodedAudio {
    if (!isRecord(value)) {
        return false;
    }

    const { samples, sample_rate: sampleRate, channels, duration_ms: durationMs, total_frames: totalFrames } = value;
    return (
        isNumberArray(samples) &&
        isPositiveInteger(sampleRate) &&
        isPositiveInteger(channels) &&
        isFiniteNumber(durationMs) &&
        durationMs >= 0 &&
        isNonNegativeInteger(totalFrames)
    );
}

function mapDecodedAudio(raw: unknown): DecodedAudio {
    if (!isRustDecodedAudio(raw)) {
        throw new TypeError('decode_audio_file returned an invalid payload');
    }

    if (raw.samples.length !== raw.channels * raw.total_frames) {
        throw new TypeError('decode_audio_file returned inconsistent sample metadata');
    }

    return {
        samples: raw.samples,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
    };
}

/**
 * Decode an audio file into interleaved f32 PCM samples.
 * Returns null when running outside Tauri.
 */
export async function decodeAudioFile(path: string): Promise<DecodedAudio | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = await tauriInvoke('decode_audio_file', { filePath: path });
    return mapDecodedAudio(raw);
}
