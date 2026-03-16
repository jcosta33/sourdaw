import { audioEngine } from "../repositories/audioEngineInstance";
import { audioBufferCache } from "../stores/audioBufferCache";

export const decodeAudioFile = async (file: File): Promise<{ id: string; buffer: AudioBuffer }> => {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await audioEngine.context.decodeAudioData(arrayBuffer);
    const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
};

export const generateSyntheticBuffer = (
    durationSeconds: number,
    sampleRate = 44100,
): { id: string; buffer: AudioBuffer } => {
    const ctx = audioEngine.context;
    const length = Math.ceil(durationSeconds * sampleRate);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            data[i] = Math.sin(2 * Math.PI * 220 * t) * 0.3 * Math.exp(-t * 0.5);
        }
    }

    const id = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
};
