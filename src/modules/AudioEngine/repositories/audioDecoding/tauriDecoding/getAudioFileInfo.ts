import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

// ── Types ───────────────────────────────────────────────────────────────

export type AudioFileInfo = {
    path: string;
    name: string;
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
    codec: string;
    sizeBytes: number;
};

// ── Rust ↔ TS key mapping helpers ───────────────────────────────────────

type RustAudioFileInfo = {
    path: string;
    name: string;
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
    codec: string;
    size_bytes: number;
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

function isRustAudioFileInfo(value: unknown): value is RustAudioFileInfo {
    if (!isRecord(value)) {
        return false;
    }

    const {
        path,
        name,
        sample_rate: sampleRate,
        channels,
        duration_ms: durationMs,
        total_frames: totalFrames,
        codec,
        size_bytes: sizeBytes,
    } = value;
    return (
        typeof path === 'string' &&
        path.length > 0 &&
        typeof name === 'string' &&
        name.length > 0 &&
        isPositiveInteger(sampleRate) &&
        isPositiveInteger(channels) &&
        isFiniteNumber(durationMs) &&
        durationMs >= 0 &&
        isNonNegativeInteger(totalFrames) &&
        typeof codec === 'string' &&
        codec.length > 0 &&
        isNonNegativeInteger(sizeBytes)
    );
}

function mapFileInfo(raw: unknown): AudioFileInfo {
    if (!isRustAudioFileInfo(raw)) {
        throw new TypeError('get_audio_file_info returned an invalid payload');
    }

    return {
        path: raw.path,
        name: raw.name,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
        codec: raw.codec,
        sizeBytes: raw.size_bytes,
    };
}

/**
 * Probe an audio file for metadata without decoding.
 * Returns null when running outside Tauri.
 */
export async function getAudioFileInfo(path: string): Promise<AudioFileInfo | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = await tauriInvoke('get_audio_file_info', { filePath: path });
    return mapFileInfo(raw);
}
