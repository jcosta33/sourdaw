/**
 * Static catalog of available DDSP instrument models.
 *
 * Models are hosted by Google Magenta (TF.js GraphModel format).
 * Base URL: https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/{instrument}
 * TF.js loadGraphModel() receives the directory URL and appends /model.json automatically.
 *
 * All models are Apache 2.0 licensed (DDSP project by Google).
 *
 * Available instruments confirmed via HTTP 200 (2025-04):
 * violin, flute, trumpet, tenor_saxophone
 */

import { type DdspInstrument } from './BrowserModel';

const DDSP_BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp';

/**
 * NSF-HiFiGAN vocoder — 2024.02 logE variant, required for modern DiffSinger v2 models.
 * Distributed as an OpenUTAU dependency package (.oudep = ZIP).
 * The download manager extracts the inner .onnx automatically.
 * Inner filename: nsf_hifigan_44.1k_hop512_128bin_2024.02.onnx
 */
export const NSF_HIFIGAN_URL =
    'https://huggingface.co/jcosta33/vocoder-models/resolve/main/nsf-hifigan-44k/nsf_hifigan_44.1k_hop512_128bin_2024.02.onnx';

export const NSF_HIFIGAN_SIZE_BYTES = 56_769_296;

/**
 * Kokoro TTS model — q8f16 quantized (int8 weights, float16 activations), 86 MB.
 * Path: onnx/model_q8f16.onnx inside onnx-community/Kokoro-82M-v1.0-ONNX.
 * The model_q8.onnx file does not exist in the repo; q8f16 is the closest equivalent.
 */
export const KOKORO_MODEL_URL =
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8f16.onnx';

export const KOKORO_MODEL_SIZE_BYTES = 86_000_000;

/**
 * Factory DDSP instrument catalog.
 */
export const DDSP_INSTRUMENT_CATALOG: Omit<DdspInstrument, 'status' | 'downloadProgress'>[] = [
    {
        id: 'ddsp-violin',
        name: 'Violin',
        family: 'ddsp',
        instrument: 'violin',
        sizeBytes: 14_800_000,
        url: `${DDSP_BASE}/violin`,
        license: 'Apache-2.0',
        attribution: 'DDSP by Google Research (Engel et al., 2020)',
        nativeSampleRate: 16000,
        frameRate: 250,
    },
    {
        id: 'ddsp-flute',
        name: 'Flute',
        family: 'ddsp',
        instrument: 'flute',
        sizeBytes: 14_800_000,
        url: `${DDSP_BASE}/flute`,
        license: 'Apache-2.0',
        attribution: 'DDSP by Google Research (Engel et al., 2020)',
        nativeSampleRate: 16000,
        frameRate: 250,
    },
    {
        id: 'ddsp-trumpet',
        name: 'Trumpet',
        family: 'ddsp',
        instrument: 'trumpet',
        sizeBytes: 14_800_000,
        url: `${DDSP_BASE}/trumpet`,
        license: 'Apache-2.0',
        attribution: 'DDSP by Google Research (Engel et al., 2020)',
        nativeSampleRate: 16000,
        frameRate: 250,
    },
    {
        id: 'ddsp-tenor-saxophone',
        name: 'Tenor Saxophone',
        family: 'ddsp',
        instrument: 'tenor_saxophone',
        sizeBytes: 14_800_000,
        url: `${DDSP_BASE}/tenor_saxophone`,
        license: 'Apache-2.0',
        attribution: 'DDSP by Google Research (Engel et al., 2020)',
        nativeSampleRate: 16000,
        frameRate: 250,
    },
];

/**
 * DiffSinger voicebank catalog — downloadable singing voice packs.
 *
 * Each voicebank contains 5 ONNX models (linguistic, dur, pitch, variance, acoustic).
 * Models are hosted on HuggingFace for CORS-accessible browser downloads.
 * The shared NSF-HiFiGAN vocoder is downloaded separately (see NSF_HIFIGAN_URL).
 */
const HF_DIFFSINGER = 'https://huggingface.co/jcosta33/vocoder-models/resolve/main/diffsinger';

function diffSingerModel(voicebankId: string, key: string, sizeBytes: number) {
    return {
        id: `${voicebankId}-${key}`,
        name: `${key}`,
        family: `diffsinger/${voicebankId}` as const,
        sizeBytes,
        url: `${HF_DIFFSINGER}/${voicebankId}/${key}.onnx`,
        license: 'CC-BY-NC-SA-4.0' as const,
        attribution: '',
        nativeSampleRate: 44100,
        status: 'not-downloaded' as const,
        downloadProgress: 0,
    };
}

export const DIFFSINGER_VOICEBANK_CATALOG = [
    {
        id: 'spore',
        name: 'SPORE',
        language: 'en' as const,
        license: 'CC-BY-NC-SA-4.0' as const,
        attribution: 'SPORE v0.1.1 by knoxstation — CC BY-NC-ND 4.0',
        totalSizeBytes: 347_558_874,
        models: {
            linguistic: diffSingerModel('spore', 'linguistic', 25_506_686),
            dur: diffSingerModel('spore', 'dur', 5_420_307),
            pitch: diffSingerModel('spore', 'pitch', 49_022_087),
            variance: diffSingerModel('spore', 'variance', 23_426_418),
            acoustic: diffSingerModel('spore', 'acoustic', 244_183_376),
        },
    },
];

/**
 * Kokoro TTS voice catalog — 21 voices, all sharing the same model weights.
 */
export const KOKORO_VOICE_CATALOG: Array<{ id: string; name: string; gender: 'male' | 'female'; accent: string }> = [
    { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'american' },
    { id: 'af_bella', name: 'Bella', gender: 'female', accent: 'american' },
    { id: 'af_sarah', name: 'Sarah', gender: 'female', accent: 'american' },
    { id: 'af_nicole', name: 'Nicole', gender: 'female', accent: 'american' },
    { id: 'af_sky', name: 'Sky', gender: 'female', accent: 'american' },
    { id: 'am_adam', name: 'Adam', gender: 'male', accent: 'american' },
    { id: 'am_michael', name: 'Michael', gender: 'male', accent: 'american' },
    { id: 'bf_emma', name: 'Emma', gender: 'female', accent: 'british' },
    { id: 'bf_isabella', name: 'Isabella', gender: 'female', accent: 'british' },
    { id: 'bm_george', name: 'George', gender: 'male', accent: 'british' },
    { id: 'bm_lewis', name: 'Lewis', gender: 'male', accent: 'british' },
    { id: 'af_alloy', name: 'Alloy', gender: 'female', accent: 'american' },
    { id: 'af_nova', name: 'Nova', gender: 'female', accent: 'american' },
    { id: 'af_shimmer', name: 'Shimmer', gender: 'female', accent: 'american' },
    { id: 'am_echo', name: 'Echo', gender: 'male', accent: 'american' },
    { id: 'am_fable', name: 'Fable', gender: 'male', accent: 'american' },
    { id: 'am_onyx', name: 'Onyx', gender: 'male', accent: 'american' },
    { id: 'am_liam', name: 'Liam', gender: 'male', accent: 'american' },
    { id: 'af_jessica', name: 'Jessica', gender: 'female', accent: 'american' },
    { id: 'af_river', name: 'River', gender: 'female', accent: 'american' },
    { id: 'am_santa', name: 'Santa', gender: 'male', accent: 'american' },
];
