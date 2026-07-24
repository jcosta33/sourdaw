import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, readFileBytes, tauriInvoke } from '#/utils/tauriBridge';

type GenerateAudioResult = {
    wav_path: string;
    duration_seconds: number;
    sample_rate: number;
};

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
            })) as GenerateAudioResult;

            logger.info(`[Audio AI] Generated: ${result.wav_path} (${String(result.duration_seconds)}s)`);

            const fileBytes = await readFileBytes({ path: result.wav_path });
            const wavBuffer = fileBytes.buffer.slice(
                fileBytes.byteOffset,
                fileBytes.byteOffset + fileBytes.byteLength
            ) as ArrayBuffer;
            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(wavBuffer);
            await audioContext.close();

            return audioBuffer;
        }
);
