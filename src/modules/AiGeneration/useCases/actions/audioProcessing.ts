import {
    denoiseAudio,
    isTauri,
} from '#/modules/AudioEngine/useCases/nativeAiBridge';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { addTask, updateTask } from './taskManagement';

export async function handleAiDenoiseClip(clipId: string, strength: number = 0.7) {
    const taskId = addTask({ type: 'denoise', status: 'processing' });
    try {
        const start = performance.now();
        const buffer = audioBufferCache.get(clipId);
        if (!buffer) { throw new Error('Audio buffer not found for clip'); }

        let outNoiseFloor = -60;

        if (isTauri()) {
            const samples = buffer.getChannelData(0);
            const res = await denoiseAudio(samples, buffer.sampleRate, buffer.numberOfChannels, strength);
            outNoiseFloor = res.noise_floor_db;
            // Store denoised result back in cache
            const ctx = new OfflineAudioContext(1, res.samples.length, buffer.sampleRate);
            const outBuffer = ctx.createBuffer(1, res.samples.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(res.samples);
            audioBufferCache.set(`${clipId}-denoised`, outBuffer);
        } else {
            // Browser: spectral noise gate (same algorithm as Rust backend)
            const mono = buffer.getChannelData(0);
            const hop = 1024;
            const noiseSamples = Math.min(
                Math.floor(buffer.sampleRate * 0.5 / hop) * hop,
                mono.length
            );

            // Estimate noise floor from first 0.5s
            let noisePower = 0;
            for (let i = 0; i < noiseSamples; i++) {
                noisePower += (mono[i] ?? 0) * (mono[i] ?? 0);
            }
            noisePower /= Math.max(noiseSamples, 1);
            outNoiseFloor = 10 * Math.log10(Math.max(noisePower, 1e-12));

            // Apply smooth noise gate
            const threshold = Math.sqrt(noisePower * (1 + strength * 3));
            const output = new Float32Array(mono.length);
            for (let i = 0; i < mono.length; i++) {
                const s = mono[i] ?? 0;
                const abs = Math.abs(s);
                if (abs < threshold) {
                    const ratio = abs / threshold;
                    output[i] = s * (ratio * (1 - strength) + (1 - ratio) * 0.05);
                } else {
                    output[i] = s;
                }
            }

            const outCtx = new OfflineAudioContext(1, output.length, buffer.sampleRate);
            const outBuffer = outCtx.createBuffer(1, output.length, buffer.sampleRate);
            outBuffer.getChannelData(0).set(output);
            audioBufferCache.set(`${clipId}-denoised`, outBuffer);
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, noiseFloorDb: outNoiseFloor },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Denoise failed' });
    }
}

export async function handleStemSeparationPreview(clipId: string) {
    const taskId = addTask({
        type: 'stem-separation',
        status: 'processing',
        prompt: 'Extracting: Drums, Bass, Vocals, Other',
    });
    try {
        const start = performance.now();

        if (isTauri()) {
            // Use native Rust stem separation (Demucs ONNX)
            const { separateStems } = await import('#/modules/AudioAnalysis/useCases/audioAi');
            const buffer = audioBufferCache.get(clipId);
            if (!buffer) { throw new Error('Audio buffer not found for clip'); }

            // Convert AudioBuffer to WAV ArrayBuffer
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
        } else {
            // Browser: use ONNX Runtime Web with Demucs model
            const { separateStems } = await import('#/modules/AudioAnalysis/useCases/audioAi');
            const buffer = audioBufferCache.get(clipId);
            if (!buffer) { throw new Error('Audio buffer not found for clip'); }

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
        }
    } catch (error: unknown) {
        updateTask(taskId, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Stem separation failed',
        });
    }
}

export async function handleGenerateAudioFallback(prompt: string, durationStr: string, _strength: number = 0.7) {
    const taskId = addTask({ type: 'audio-generation', status: 'processing', prompt });
    try {
        const start = performance.now();

        const { generateAudio, isAudioGenerationAvailable } = await import('#/modules/AudioAnalysis/useCases/audioAi');
        if (!isAudioGenerationAvailable()) {
            throw new Error('Audio generation requires the Sourdaw desktop app (uses Stable Audio Open via Python sidecar)');
        }

        const duration = parseInt(durationStr) || 8;
        const buffer = await generateAudio(prompt, duration);
        audioBufferCache.set(`generated-${crypto.randomUUID()}`, buffer);

        updateTask(taskId, {
            status: 'success',
            data: { format: 'wav', lengthSeconds: duration },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
    }
}

/** Convert an AudioBuffer to WAV ArrayBuffer for transport. */
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

    // WAV header
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels and write 16-bit samples
    let offset = 44;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }
    for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]?.[i] ?? 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return wavBuffer;
}
