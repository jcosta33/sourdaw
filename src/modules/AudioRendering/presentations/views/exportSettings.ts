import { createStore } from '#/infra/store/createStore';
import { createPlainJsonLocalStorage } from '#/infra/store/storage/createPlainJsonLocalStorage';
import { type Store } from '#/infra/store/types';

export type ExportFormat = 'wav' | 'mp3' | 'flac';
export type Mp3BitRate = 96 | 128 | 192 | 320;

/**
 * Dither applied when quantizing to a fixed bit depth.
 *
 * `random` is the historical behaviour and stays the default; `seeded` and
 * `none` exist so an export can be reproduced byte for byte.
 */
export type ExportDither = 'random' | 'seeded' | 'none';

/**
 * Loudness normalization applied before encoding.
 *
 * `off` is the default and leaves the mix at its authored level, with only the
 * existing sample-peak clip guard. `r128` measures programme loudness and true
 * peak and applies one gain to hit the target without breaching the ceiling.
 */
export type ExportNormalization = 'off' | 'r128';

/** EBU R 128 broadcast target; also the common streaming delivery level. */
export const R128_TARGET_LUFS = -14;

/** EBU R 128 recommends -1 dBTP for lossy delivery. */
export const R128_CEILING_DB_TP = -1;

export type ExportSettings = {
    formats: ExportFormat[];
    sampleRate: number;
    bitDepth: number;
    mp3BitRate: Mp3BitRate;
    dither: ExportDither;
    normalization: ExportNormalization;
};

/**
 * Upper bound for the manually entered export tail, in seconds. The
 * auto-detected tail is capped by the estimator that produces it; this is only
 * the bound on what a user may type into the field.
 */
export const MAX_MANUAL_TAIL_SECONDS = 60;

const EXPORT_SETTINGS_KEY = 'sourdaw:export-settings';
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
    formats: ['wav'],
    sampleRate: 44100,
    bitDepth: 24,
    mp3BitRate: 128,
    dither: 'random',
    normalization: 'off',
};

const validExportFormats: readonly string[] = ['wav', 'mp3', 'flac'];
const validSampleRates: readonly number[] = [44100, 48000, 88200, 96000];
const validBitDepths: readonly number[] = [16, 24, 32];

type ReadNumberInput = {
    value: unknown;
    allowed: readonly number[];
    fallback: number;
};

function createDefaultExportSettings(): ExportSettings {
    return { ...DEFAULT_EXPORT_SETTINGS, formats: [...DEFAULT_EXPORT_SETTINGS.formats] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExportFormat(value: unknown): value is ExportFormat {
    return typeof value === 'string' && validExportFormats.includes(value);
}

function readNumber(input: ReadNumberInput): number {
    return typeof input.value === 'number' && input.allowed.includes(input.value) ? input.value : input.fallback;
}

function readMp3BitRate(value: unknown): Mp3BitRate {
    if (value === 96 || value === 128 || value === 192 || value === 320) {
        return value;
    }
    return DEFAULT_EXPORT_SETTINGS.mp3BitRate;
}

function readDither(value: unknown): ExportDither {
    if (value === 'random' || value === 'seeded' || value === 'none') {
        return value;
    }
    return DEFAULT_EXPORT_SETTINGS.dither;
}

function readNormalization(value: unknown): ExportNormalization {
    if (value === 'off' || value === 'r128') {
        return value;
    }
    return DEFAULT_EXPORT_SETTINGS.normalization;
}

function readFormats(parsed: Record<string, unknown>): ExportFormat[] {
    if (Array.isArray(parsed.formats)) {
        const formats = parsed.formats.filter(isExportFormat);
        return formats.length > 0 ? formats : createDefaultExportSettings().formats;
    }
    if (isExportFormat(parsed.format)) {
        return [parsed.format];
    }
    return createDefaultExportSettings().formats;
}

function sanitizeExportSettings(value: unknown): ExportSettings {
    if (!isRecord(value)) {
        return createDefaultExportSettings();
    }

    return {
        formats: readFormats(value),
        sampleRate: readNumber({
            value: value.sampleRate,
            allowed: validSampleRates,
            fallback: DEFAULT_EXPORT_SETTINGS.sampleRate,
        }),
        bitDepth: readNumber({
            value: value.bitDepth,
            allowed: validBitDepths,
            fallback: DEFAULT_EXPORT_SETTINGS.bitDepth,
        }),
        mp3BitRate: readMp3BitRate(value.mp3BitRate),
        dither: readDither(value.dither),
        normalization: readNormalization(value.normalization),
    };
}

type CreateExportSettingsStoreOutput = Store<ExportSettings>;

function createExportSettingsStore(): CreateExportSettingsStoreOutput {
    return createStore<ExportSettings>({
        storage: createPlainJsonLocalStorage({
            key: EXPORT_SETTINGS_KEY,
            decode: sanitizeExportSettings,
        }),
    });
}

export function loadExportSettings(): ExportSettings {
    try {
        return sanitizeExportSettings(createExportSettingsStore().value);
    } catch {
        return createDefaultExportSettings();
    }
}

export function saveExportSettings(settings: ExportSettings): void {
    try {
        createExportSettingsStore().set(settings);
    } catch {
        /* ignore */
    }
}
