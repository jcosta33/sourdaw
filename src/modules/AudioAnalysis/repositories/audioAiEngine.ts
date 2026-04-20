/**
 * Repository: AI Audio Engine.
 *
 * Stem separation:
 *   - Tauri: native Demucs ONNX via ort crate (auto-downloads ~235MB model)
 *   - Browser: Demucs ONNX via onnxruntime-web (same model, WebGPU/WASM)
 *
 * Audio generation (Stable Audio Open):
 *   - Tauri: Python sidecar (auto-started, model auto-downloads ~1.7GB)
 *   - Browser: desktop-only feature (requires PyTorch)
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

/**
 * Check if stem separation is available.
 * Always true — both Tauri and browser have native ONNX implementations.
 */
export function isStemSeparationAvailable(): boolean {
    return true;
}

/**
 * Check if audio generation is available.
 * Only works in Tauri (requires Python sidecar for Stable Audio Open).
 */
export function isAudioGenerationAvailable(): boolean {
    return isTauri();
}

// Keep for backward compat — used by generateAudio handler
export async function isAudioAiServerRunning(): Promise<boolean> {
    return isTauri();
}

/**
 * Generate audio from a text prompt using Stable Audio Open.
 * Desktop only — uses a Python sidecar that auto-starts and auto-downloads the model.
 */
export const generateAudio = inject({ logger })(
    ({ logger }) =>
        async function generateAudio(
            prompt: string,
            durationSeconds: number = 8,
            options?: { bpm?: number; key?: string; durationBars?: number }
        ): Promise<AudioBuffer> {
            if (!isTauri()) {
                throw new Error('Audio generation is a desktop-only feature. It requires the Sourdaw desktop app.');
            }

            logger.info(`[Audio AI] Generating audio: "${prompt}" (${String(durationSeconds)}s)`);

            const result = (await tauriInvoke('generate_audio_clip', {
                prompt,
                bpm: options?.bpm ?? null,
                key: options?.key ?? null,
                durationBars: options?.durationBars ?? null,
                durationSeconds,
            })) as { wav_path: string; duration_seconds: number; sample_rate: number };

            logger.info(`[Audio AI] Generated: ${result.wav_path} (${String(result.duration_seconds)}s)`);

            // Load WAV file into AudioBuffer
            const fileBytes = (await tauriInvoke('read_audio_file', { path: result.wav_path })) as Uint8Array;
            const wavBuffer = fileBytes.buffer as ArrayBuffer;
            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(wavBuffer);
            await audioContext.close();

            return audioBuffer;
        }
);

type StemResult = {
    [stemName: string]: AudioBuffer;
};

/**
 * Separate audio into stems using Demucs v4 ONNX.
 *
 * In Tauri: native Rust inference via ort crate.
 * In browser: onnxruntime-web with WebGPU/WASM.
 * Both auto-download the ~235MB model on first use.
 */
export const separateStems = inject({ logger })(({ logger }) => {
    /**
     * Native stem separation via Tauri Rust command.
     * Writes WAV to temp file, passes path to Rust (avoids large JSON IPC).
     */
    const separateStemsNative = async (audioData: ArrayBuffer, stems: string[]): Promise<StemResult> => {
        const tempPath = `__sourdaw_stems_input_${String(Date.now())}.wav`;
        const wavBytes = new Uint8Array(audioData);
        await tauriInvoke('write_audio_file', { path: tempPath, data: wavBytes });

        logger.info(`[Audio AI] Starting native stem separation...`);

        const result = (await tauriInvoke('separate_stems', {
            request: {
                audio_path: tempPath,
                stems,
            },
        })) as { stem_paths: Record<string, string>; processing_time_ms: number };

        logger.info(`[Audio AI] Native separation completed in ${String(result.processing_time_ms)}ms`);

        const stemBuffers: StemResult = {};

        for (const [name, filePath] of Object.entries(result.stem_paths)) {
            try {
                const fileBytes = (await tauriInvoke('read_audio_file', { path: filePath })) as Uint8Array;
                const wavBuffer = fileBytes.buffer as ArrayBuffer;
                const audioContext = new AudioContext();
                stemBuffers[name] = await audioContext.decodeAudioData(wavBuffer);
                await audioContext.close();
            } catch (error) {
                logger.warn(`[Audio AI] Failed to load stem "${name}" from ${filePath}: ${String(error)}`);
            }
        }

        return stemBuffers;
    };

    return async function separateStems(audioData: ArrayBuffer, stems: string[] = ['all']): Promise<StemResult> {
        logger.info(`[Audio AI] Separating stems: ${stems.join(', ')}`);

        if (isTauri()) {
            return separateStemsNative(audioData, stems);
        }

        const { separateStemsBrowser } = await import('./browserStemSeparation');
        return separateStemsBrowser(audioData, stems);
    };
});
