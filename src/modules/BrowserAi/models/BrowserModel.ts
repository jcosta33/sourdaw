/**
 * Domain model for a downloadable AI model used in browser inference.
 */

export type ModelFamily =
    | 'ddsp'
    | 'kokoro'
    | 'diffsinger-linguistic'
    | 'diffsinger-dur'
    | 'diffsinger-pitch'
    | 'diffsinger-acoustic'
    | 'diffsinger-variance'
    | 'diffsinger/vocoder';

export type ModelDownloadStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error' | 'stale';

export type ModelLicense = 'Apache-2.0' | 'CC-BY-NC-SA-4.0' | 'MIT' | 'Unverified';

export type BrowserModel = {
    id: string;
    name: string;
    family: ModelFamily;
    /** Model size in bytes */
    sizeBytes: number;
    /** Remote URL to download the ONNX/TF.js model from */
    url: string;
    license: ModelLicense;
    /** Attribution string required by the license */
    attribution: string;
    /** Sample rate the model natively outputs */
    nativeSampleRate: number;
    status: ModelDownloadStatus;
    /** Download progress 0–1 when status is 'downloading' */
    downloadProgress: number;
    /** SHA256 hash of the model file for integrity verification */
    sha256?: string;
};

export type DdspInstrument = BrowserModel & {
    family: 'ddsp';
    /** Instrument label for the UI selector */
    instrument: string;
    /** TF.js GraphModel frame rate (250 Hz for standard DDSP) */
    frameRate: number;
    /** Pinned multi-file GraphModel artifact set when the instrument is release-admitted. */
    artifacts?: readonly import('./DdspArtifactManifest').DdspArtifact[];
    /** Immutable source version for the pinned artifact set. */
    artifactVersion?: string;
};

export type KokoroModel = BrowserModel & {
    family: 'kokoro';
    /** Quantization variant (q4 | q8 | fp16) */
    quantization: 'q4' | 'q8' | 'fp16';
};

export type DiffSingerVoicebank = {
    id: string;
    name: string;
    language: 'en' | 'zh' | 'ja';
    license: ModelLicense;
    attribution: string;
    /** Total compressed size of all ONNX files in bytes */
    totalSizeBytes: number;
    status: ModelDownloadStatus;
    downloadProgress: number;
    models: {
        /** Shared phoneme encoder — produces encoder_out and x_masks */
        linguistic: BrowserModel;
        /** Duration predictor — produces ph_dur from encoder_out */
        dur: BrowserModel;
        /** Pitch predictor — produces f0 curve */
        pitch: BrowserModel;
        /** Variance predictor — produces energy, breathiness, tension */
        variance: BrowserModel;
        /** Acoustic model — shallow diffusion, produces mel-spectrogram */
        acoustic: BrowserModel;
    };
};

/** Shared singing vocoder — downloaded once, reused across all voicebanks. */
export type VocoderModel = BrowserModel & {
    family: 'diffsinger/vocoder';
};
