import { inject } from '#/infra/di/inject';
import { createAiGenerationError } from '../../errors/AiGenerationError';
import { isAppError } from '#/infra/errors/isAppError';
import { separateStems } from '#/modules/AudioAnalysis';
import { audioBufferCache } from '#/modules/AudioEngine';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export const handleStemSeparationPreview = inject({
    addTask,
    updateTask,
    separateStems,
    audioBufferCache,
})(
    ({ addTask, updateTask, separateStems }) =>
        async function handleStemSeparationPreview(clipId: string) {
            const taskId = addTask({
                type: 'stem-separation',
                status: 'processing',
                prompt: 'Extracting: Drums, Bass, Vocals, Other',
            });
            try {
                const start = performance.now();

                const buffer = audioBufferCache.get(clipId);
                if (!buffer) {
                    throw createAiGenerationError('Audio buffer not found for clip');
                }

                const wavData = audioBufferToWav(buffer);
                const stemResults = await separateStems(wavData, ['all']);

                const stemNames = Object.keys(stemResults);
                for (const [name, stemBuffer] of Object.entries(stemResults)) {
                    audioBufferCache.set(`${clipId}-${name}`, stemBuffer);
                }

                updateTask(taskId, {
                    status: 'success',
                    data: { clipId, stems: stemNames },
                    durationMs: Math.round(performance.now() - start),
                });
            } catch (error: unknown) {
                updateTask(taskId, {
                    status: 'error',
                    error: isAppError(error)
                        ? error.message
                        : error instanceof Error
                          ? error.message
                          : 'Stem separation failed',
                });
            }
        }
);

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const headerSize = 44;
    const wavBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }
    for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]?.[i] ?? 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return wavBuffer;
}
