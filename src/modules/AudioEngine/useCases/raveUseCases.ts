/**
 * RAVE Neural Audio Synthesis
 *
 * Real-time Audio Variational autoEncoder for timbre transfer
 * and neural synthesis. Provides a latent space interface for
 * transforming audio through trained timbre models.
 *
 * Architecture:
 *   1. Encode input audio → latent representation
 *   2. Manipulate latent space (interpolate, randomize, transfer)
 *   3. Decode latent → output audio
 *
 * Models run via ONNX Runtime (browser) or native Rust sidecar.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type RaveModel = {
    id: string;
    name: string;
    /** What timbre this model was trained on */
    category: 'strings' | 'vocals' | 'synth' | 'percussion' | 'ambient' | 'custom';
    /** Latent space dimensionality */
    latentDim: number;
    /** Sample rate the model expects */
    sampleRate: number;
    /** Model file size in MB */
    sizeMb: number;
    /** Is the model loaded in memory? */
    loaded: boolean;
    /** ONNX model path or URL */
    modelPath: string;
};

export type LatentVector = {
    /** Latent dimension values */
    values: number[];
    /** Timestamp in the source audio */
    timeSec: number;
};

export type RaveState = {
    /** Available models */
    models: RaveModel[];
    /** Currently active model ID */
    activeModelId: string | null;
    /** Timbre transfer blend (0 = original, 1 = fully transferred) */
    transferBlend: number;
    /** Latent space temperature (randomness) */
    temperature: number;
    /** Whether real-time processing is enabled */
    realTimeEnabled: boolean;
    /** Latent space cache for current operation */
    latentCache: LatentVector[];
};

export const raveStore = new Store<RaveState>(logger, {
    initialData: {
        models: [],
        activeModelId: null,
        transferBlend: 0.5,
        temperature: 1.0,
        realTimeEnabled: false,
        latentCache: [],
    },
});

// ── Model Management ──────────────────────────────────────────────────

const FACTORY_MODELS: Omit<RaveModel, 'loaded'>[] = [
    { id: 'rave-strings', name: 'Orchestral Strings', category: 'strings', latentDim: 16, sampleRate: 48000, sizeMb: 45, modelPath: 'models/rave/strings.onnx' },
    { id: 'rave-vocals', name: 'Vocal Synthesis', category: 'vocals', latentDim: 16, sampleRate: 48000, sizeMb: 52, modelPath: 'models/rave/vocals.onnx' },
    { id: 'rave-synth', name: 'Analog Synth', category: 'synth', latentDim: 8, sampleRate: 44100, sizeMb: 30, modelPath: 'models/rave/synth.onnx' },
    { id: 'rave-percussion', name: 'Percussion', category: 'percussion', latentDim: 8, sampleRate: 44100, sizeMb: 28, modelPath: 'models/rave/percussion.onnx' },
    { id: 'rave-ambient', name: 'Ambient Textures', category: 'ambient', latentDim: 32, sampleRate: 48000, sizeMb: 60, modelPath: 'models/rave/ambient.onnx' },
];

export function registerFactoryModels(): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: FACTORY_MODELS.map((m) => ({ ...m, loaded: false })),
    });
}

export function loadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    // In production, this would load the ONNX model into runtime
    raveStore.set({
        ...state,
        models: state.models.map((m) => (m.id === modelId ? { ...m, loaded: true } : m)),
        activeModelId: modelId,
    });
    logger.info(`RAVE model loaded: ${modelId}`);
}

export function unloadModel(modelId: string): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({
        ...state,
        models: state.models.map((m) => (m.id === modelId ? { ...m, loaded: false } : m)),
        activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
    });
}

// ── Encoding / Decoding ───────────────────────────────────────────────

/**
 * Encode audio samples into latent space vectors.
 * In production this calls the ONNX encoder model.
 * Here we simulate with a deterministic transform.
 */
export function encodeAudio(
    samples: Float32Array,
    sampleRate: number,
    latentDim: number = 16
): LatentVector[] {
    const frameSize = Math.floor(sampleRate * 0.02); // 20ms frames
    const vectors: LatentVector[] = [];

    for (let i = 0; i < samples.length - frameSize; i += frameSize) {
        // Simulate encoding: extract spectral features
        const values: number[] = [];
        for (let d = 0; d < latentDim; d++) {
            let sum = 0;
            const stride = Math.floor(frameSize / latentDim);
            for (let j = 0; j < stride; j++) {
                const idx = i + d * stride + j;
                if (idx < samples.length) {
                    sum += samples[idx]! * Math.sin((d + 1) * j * 0.1);
                }
            }
            values.push(Math.tanh(sum * 10));
        }

        vectors.push({
            values,
            timeSec: i / sampleRate,
        });
    }

    const state = raveStore.value;
    if (state) {
        raveStore.set({ ...state, latentCache: vectors });
    }

    return vectors;
}

/**
 * Decode latent vectors back to audio samples.
 * In production this calls the ONNX decoder model.
 */
export function decodeLatent(
    vectors: LatentVector[],
    sampleRate: number
): Float32Array {
    const frameSize = Math.floor(sampleRate * 0.02);
    const totalSamples = vectors.length * frameSize;
    const output = new Float32Array(totalSamples);

    for (let vi = 0; vi < vectors.length; vi++) {
        const v = vectors[vi]!;
        const offset = vi * frameSize;

        for (let j = 0; j < frameSize; j++) {
            let sample = 0;
            for (let d = 0; d < v.values.length; d++) {
                sample += v.values[d]! * Math.sin(2 * Math.PI * (d + 1) * 100 * j / sampleRate) * 0.1;
            }
            if (offset + j < output.length) {
                output[offset + j] = Math.tanh(sample);
            }
        }
    }

    return output;
}

/**
 * Perform timbre transfer: encode source, blend with target model's characteristics.
 */
export function timbreTransfer(
    sourceVectors: LatentVector[],
    targetVectors: LatentVector[],
    blend: number
): LatentVector[] {
    const clampedBlend = Math.max(0, Math.min(1, blend));

    return sourceVectors.map((sv, i) => {
        const tv = targetVectors[i % targetVectors.length];
        if (!tv) {
            return sv;
        }

        return {
            timeSec: sv.timeSec,
            values: sv.values.map((val, d) => {
                const targetVal = tv.values[d] ?? 0;
                return val * (1 - clampedBlend) + targetVal * clampedBlend;
            }),
        };
    });
}

/**
 * Interpolate between two latent vectors for morphing.
 */
export function interpolateLatent(
    a: LatentVector,
    b: LatentVector,
    t: number
): LatentVector {
    return {
        timeSec: a.timeSec * (1 - t) + b.timeSec * t,
        values: a.values.map((val, d) => val * (1 - t) + (b.values[d] ?? 0) * t),
    };
}

/**
 * Randomize latent vectors with controlled temperature.
 */
export function randomizeLatent(
    vectors: LatentVector[],
    temperature: number
): LatentVector[] {
    return vectors.map((v) => ({
        timeSec: v.timeSec,
        values: v.values.map((val) => {
            const noise = (Math.random() * 2 - 1) * temperature;
            return Math.tanh(val + noise);
        }),
    }));
}

// ── Controls ──────────────────────────────────────────────────────────

export function setTransferBlend(blend: number): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({ ...state, transferBlend: Math.max(0, Math.min(1, blend)) });
}

export function setTemperature(temp: number): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({ ...state, temperature: Math.max(0, Math.min(3, temp)) });
}

export function toggleRealTime(): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({ ...state, realTimeEnabled: !state.realTimeEnabled });
}
