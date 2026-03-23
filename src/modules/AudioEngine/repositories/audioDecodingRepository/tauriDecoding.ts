import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';

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

export type DecodedAudio = {
    samples: number[];
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
};

export type WaveformPeak = {
    min: number;
    max: number;
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

type RustDecodedAudio = {
    samples: number[];
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
};

function mapFileInfo(raw: RustAudioFileInfo): AudioFileInfo {
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

function mapDecodedAudio(raw: RustDecodedAudio): DecodedAudio {
    return {
        samples: raw.samples,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
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
    const raw = (await tauriInvoke('get_audio_file_info', { path })) as RustAudioFileInfo;
    return mapFileInfo(raw);
}

/**
 * Decode an audio file into interleaved f32 PCM samples.
 * Returns null when running outside Tauri.
 */
export async function decodeAudioFile(path: string): Promise<DecodedAudio | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = (await tauriInvoke('decode_audio_file', { path })) as RustDecodedAudio;
    return mapDecodedAudio(raw);
}
