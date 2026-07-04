export type ExportFormat = 'wav' | 'mp3' | 'flac';
export type Mp3BitRate = 96 | 128 | 192 | 320;

export type ExportSettings = {
    formats: ExportFormat[];
    sampleRate: number;
    bitDepth: number;
    mp3BitRate: Mp3BitRate;
};

const EXPORT_SETTINGS_KEY = 'sourdaw:export-settings';
const DEFAULT_EXPORT_SETTINGS: ExportSettings = { formats: ['wav'], sampleRate: 44100, bitDepth: 24, mp3BitRate: 128 };

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
    };
}

export function loadExportSettings(): ExportSettings {
    try {
        const stored = window.localStorage.getItem(EXPORT_SETTINGS_KEY);
        if (stored) {
            const parsed: unknown = JSON.parse(stored);
            return sanitizeExportSettings(parsed);
        }
    } catch {
        /* ignore */
    }
    return createDefaultExportSettings();
}

export function saveExportSettings(settings: ExportSettings): void {
    try {
        window.localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        /* ignore */
    }
}
