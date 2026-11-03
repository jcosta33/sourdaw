import { type DeliverySettings } from '../models/DeliveryTarget';
import { type PcmDitherOptions } from '../repositories/audioEncoders/convertFloatChannelsToPcm';

import { type audioBufferToMp3 } from './audioBufferToMp3';
import { validatePodcastMetadata } from './validatePodcastMetadata';

type TargetDraft = {
    id: string;
    name: string;
    settings: DeliverySettings;
    dither: PcmDitherOptions;
    metadata?: Parameters<typeof audioBufferToMp3>[4];
};

function validateTargetId(id: string, ids: Set<string>): void {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
        throw new Error('Invalid delivery target id.');
    }
    if (ids.has(id)) {
        throw new Error('Duplicate delivery target id.');
    }
    ids.add(id);
}

function resolveSampleRate(settings: DeliverySettings, sourceSampleRate?: number): number {
    const sampleRate = settings.sampleRate === 'source' ? sourceSampleRate : settings.sampleRate;
    if (sampleRate === undefined || ![44100, 48000, 88200, 96000].includes(sampleRate)) {
        throw new Error(
            settings.sampleRate === 'source'
                ? 'The source sample rate is unavailable or unsupported. Choose an explicit output rate.'
                : 'Unsupported delivery sample rate.'
        );
    }
    return sampleRate;
}

function resolveFormats(settings: DeliverySettings): DeliverySettings['formats'][number][] {
    const formats = [...new Set(settings.formats)];
    if (formats.length === 0 || formats.some((format) => !['wav', 'mp3', 'flac', 'ogg', 'opus'].includes(format))) {
        throw new Error('Unsupported delivery format.');
    }
    if (formats.includes('flac') && settings.bitDepth === 32) {
        throw new Error('FLAC export supports 16-bit or 24-bit only.');
    }
    return formats;
}

function validateMp3Settings(settings: DeliverySettings, sampleRate: number, formats: readonly string[]): void {
    if (!formats.includes('mp3')) {
        return;
    }
    if (![44100, 48000].includes(sampleRate)) {
        throw new Error('MP3 cannot preserve the requested output rate. Choose 44.1 or 48 kHz.');
    }
    if (![96, 128, 192, 320].includes(settings.mp3BitRate)) {
        throw new Error('Unsupported MP3 bitrate.');
    }
    // The installed LAME wrapper leaves out_samplerate automatic. At 96 kbps its stereo
    // lowpass selects 32 kHz; refusing preserves the rate the musician actually requested.
    if (settings.mp3BitRate === 96 && settings.channels === 2) {
        throw new Error('96 kbps stereo MP3 changes the output rate. Choose a higher bitrate or mono.');
    }
}

function validateNormalization(settings: DeliverySettings): void {
    if (settings.normalization !== 'off' && settings.normalization !== 'r128') {
        throw new Error('Unsupported normalization mode.');
    }
    if (!Number.isFinite(settings.targetLufs) || settings.targetLufs < -70 || settings.targetLufs > -1) {
        throw new Error('Target loudness must be between -70 and -1 LUFS.');
    }
    if (!Number.isFinite(settings.ceilingDbTp) || settings.ceilingDbTp < -20 || settings.ceilingDbTp > 0) {
        throw new Error('True peak ceiling must be between -20 and 0 dBTP.');
    }
}

function copyTargetMetadata(draft: TargetDraft, formats: readonly string[]): TargetDraft['metadata'] {
    if (!formats.includes('mp3') || !draft.metadata) {
        return undefined;
    }
    const metadata = {
        title: draft.metadata.title,
        artist: draft.metadata.artist,
        description: draft.metadata.description,
    };
    validatePodcastMetadata(metadata);
    return metadata;
}

function copyTargetDither(dither: PcmDitherOptions): PcmDitherOptions {
    if (dither.mode !== 'none' && dither.mode !== 'tpdf') {
        throw new Error('Unsupported delivery dither mode.');
    }
    if (
        Object.hasOwn(dither, 'seed') &&
        (dither.seed === undefined || !Number.isSafeInteger(dither.seed) || dither.seed < 0 || dither.seed > 0xffffffff)
    ) {
        throw new Error('Delivery dither seed must be an unsigned 32-bit integer.');
    }
    const copy: PcmDitherOptions = { mode: dither.mode };
    if (Object.hasOwn(dither, 'seed')) {
        copy.seed = dither.seed;
    }
    return copy;
}

function resolveTarget(draft: TargetDraft, ids: Set<string>, sourceSampleRate?: number) {
    validateTargetId(draft.id, ids);
    const settings = draft.settings;
    const sampleRate = resolveSampleRate(settings, sourceSampleRate);
    if (settings.channels !== 1 && settings.channels !== 2) {
        throw new Error('Choose mono or stereo output.');
    }
    if (![16, 24, 32].includes(settings.bitDepth)) {
        throw new Error('Unsupported delivery bit depth.');
    }
    const formats = resolveFormats(settings);
    validateMp3Settings(settings, sampleRate, formats);
    validateNormalization(settings);
    const metadata = copyTargetMetadata(draft, formats);
    return {
        ...settings,
        id: draft.id,
        name: draft.name,
        formats,
        sampleRate,
        dither: copyTargetDither(draft.dither),
        metadata,
    };
}

/** Capture and validate the complete plan before acquiring storage or rendering. */
export function resolveDeliveryTargets(input: { targets: readonly TargetDraft[]; sourceSampleRate?: number }) {
    if (input.targets.length === 0) {
        throw new Error('Select at least one delivery target.');
    }
    const ids = new Set<string>();
    return input.targets.map((draft) => resolveTarget(draft, ids, input.sourceSampleRate));
}
