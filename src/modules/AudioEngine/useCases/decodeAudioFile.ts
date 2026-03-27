import { audioEngine } from '../repositories/createWebAudioEngine';
import { audioBufferCache } from '../stores/audioBufferCache';
import { decodeAudioFile as nativeDecodeAudioFile, samplesToAudioBuffer } from '../repositories/audioDecoding';
import { isTauri } from '#/helpers/tauriBridge';

/**
 * Decode an audio file from a File object.
 *
 * - In Tauri: uses the native symphonia decoder via `audioDecodingRepository`
 *   for broad codec support (OGG, FLAC, AAC, ALAC, MP3 on WebKit).
 * - In browser: falls back to Web Audio `decodeAudioData`.
 *
 * The decoded buffer is automatically cached in `audioBufferCache`.
 */
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    if (isTauri()) {
        try {
            // Write to a temp file path so Rust can decode from disk
            const { invoke } = await import('@tauri-apps/api/core');
            const tempDir = (await invoke('get_model_dir')) as string;
            const tempPath = `${tempDir}/../cache/${file.name}`;

            // Write the file bytes
            await invoke('write_audio_file', {
                path: tempPath,
                data: Array.from(new Uint8Array(arrayBuffer)),
            });

            // Decode using the new typed repository
            const decoded = await nativeDecodeAudioFile(tempPath);
            if (decoded) {
                const ctx = audioEngine.context;
                const buffer = samplesToAudioBuffer(decoded, ctx);
                const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                audioBufferCache.set(id, buffer);
                return { id, buffer };
            }
        } catch {
            // Fallback to Web Audio if Tauri command fails
        }
    }

    // Web Audio fallback
    const buffer = await audioEngine.context.decodeAudioData(arrayBuffer);
    const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
