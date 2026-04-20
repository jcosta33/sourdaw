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
