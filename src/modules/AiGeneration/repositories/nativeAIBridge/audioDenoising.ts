import { invokeAI } from './invokeAI';

export type DenoiseResult = {
    samples: Float32Array;
    noise_floor_db: number;
    processing_time_ms: number;
};

const BYTES_PER_SAMPLE = 4;

/**
 * Denoise audio through the native desktop command bridge.
 *
 * Samples cross as Float32 little-endian bytes, matching
 * `register_timeline_sample`. The native command
 * body owns the length ceiling.
 */
export async function denoiseAudio(
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    strength = 0.7
): Promise<DenoiseResult> {
    const result = await invokeAI('denoise_audio', {
        request: {
            sample_rate: sampleRate,
            channels,
            strength,
        },
        samples: encodeFloat32LittleEndian(samples),
    });
    return parseDenoiseResult(result);
}

function encodeFloat32LittleEndian(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(samples.length * BYTES_PER_SAMPLE);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index++) {
        view.setFloat32(index * BYTES_PER_SAMPLE, samples[index] ?? 0, true);
    }
    return bytes;
}

function parseDenoiseResult(value: unknown): DenoiseResult {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('denoise_audio result is not an object');
    }
    if (!('noise_floor_db' in value) || !('processing_time_ms' in value) || !('samples' in value)) {
        throw new TypeError('denoise_audio result is missing fields');
    }
    if (typeof value.noise_floor_db !== 'number' || typeof value.processing_time_ms !== 'number') {
        throw new TypeError('denoise_audio result is missing numeric metadata');
    }
    return {
        samples: decodeFloat32LittleEndian(asSampleBuffer(value.samples)),
        noise_floor_db: value.noise_floor_db,
        processing_time_ms: value.processing_time_ms,
    };
}

function asSampleBuffer(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }
    throw new TypeError('denoise_audio result samples must be a Buffer, not a JSON number array');
}

function decodeFloat32LittleEndian(bytes: Uint8Array): Float32Array {
    if (bytes.byteLength % BYTES_PER_SAMPLE !== 0) {
        throw new RangeError('Denoise sample payload is not a whole number of f32 values');
    }
    const samples = new Float32Array(bytes.byteLength / BYTES_PER_SAMPLE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index++) {
        samples[index] = view.getFloat32(index * BYTES_PER_SAMPLE, true);
    }
    return samples;
}
