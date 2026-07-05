import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

type StemResult = Record<string, AudioBuffer>;

export const separateStems = inject({ logger })(({ logger }) => {
    async function separateStemsNative(audioData: ArrayBuffer, stems: string[]): Promise<StemResult> {
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
    }

    return async function separateStems(audioData: ArrayBuffer, stems: string[] = ['all']): Promise<StemResult> {
        logger.info(`[Audio AI] Separating stems: ${stems.join(', ')}`);

        if (isTauri()) {
            return separateStemsNative(audioData, stems);
        }

        const { separateStemsBrowser } = await import('./browserStemSeparation');
        return separateStemsBrowser(audioData, stems);
    };
});
