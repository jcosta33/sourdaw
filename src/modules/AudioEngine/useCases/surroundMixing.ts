/**
 * Spatial Audio / Surround Mixing.
 * Multi-channel master buses (5.1, 7.1.4) and object-based panning.
 */

export type SurroundFormat = 'stereo' | '5.1' | '7.1' | '7.1.4' | 'binaural';

export type SpeakerPosition = {
    label: string;
    azimuth: number;
    elevation: number;
};

export type SurroundBus = {
    id: string;
    format: SurroundFormat;
    channelCount: number;
};

const FORMAT_CHANNELS: Record<SurroundFormat, number> = {
    stereo: 2,
    '5.1': 6,
    '7.1': 8,
    '7.1.4': 12,
    binaural: 2,
};

const FORMAT_SPEAKERS: Record<SurroundFormat, SpeakerPosition[]> = {
    stereo: [
        { label: 'L', azimuth: -30, elevation: 0 },
        { label: 'R', azimuth: 30, elevation: 0 },
    ],
    '5.1': [
        { label: 'L', azimuth: -30, elevation: 0 },
        { label: 'R', azimuth: 30, elevation: 0 },
        { label: 'C', azimuth: 0, elevation: 0 },
        { label: 'LFE', azimuth: 0, elevation: -30 },
        { label: 'Ls', azimuth: -110, elevation: 0 },
        { label: 'Rs', azimuth: 110, elevation: 0 },
    ],
    '7.1': [
        { label: 'L', azimuth: -30, elevation: 0 },
        { label: 'R', azimuth: 30, elevation: 0 },
        { label: 'C', azimuth: 0, elevation: 0 },
        { label: 'LFE', azimuth: 0, elevation: -30 },
        { label: 'Ls', azimuth: -90, elevation: 0 },
        { label: 'Rs', azimuth: 90, elevation: 0 },
        { label: 'Lrs', azimuth: -135, elevation: 0 },
        { label: 'Rrs', azimuth: 135, elevation: 0 },
    ],
    '7.1.4': [
        { label: 'L', azimuth: -30, elevation: 0 },
        { label: 'R', azimuth: 30, elevation: 0 },
        { label: 'C', azimuth: 0, elevation: 0 },
        { label: 'LFE', azimuth: 0, elevation: -30 },
        { label: 'Ls', azimuth: -90, elevation: 0 },
        { label: 'Rs', azimuth: 90, elevation: 0 },
        { label: 'Lrs', azimuth: -135, elevation: 0 },
        { label: 'Rrs', azimuth: 135, elevation: 0 },
        { label: 'Ltf', azimuth: -45, elevation: 45 },
        { label: 'Rtf', azimuth: 45, elevation: 45 },
        { label: 'Ltr', azimuth: -135, elevation: 45 },
        { label: 'Rtr', azimuth: 135, elevation: 45 },
    ],
    binaural: [
        { label: 'L', azimuth: -90, elevation: 0 },
        { label: 'R', azimuth: 90, elevation: 0 },
    ],
};

export function createSurroundBus(format: SurroundFormat): SurroundBus {
    return {
        id: `surround-${format}-${crypto.randomUUID().slice(0, 8)}`,
        format,
        channelCount: FORMAT_CHANNELS[format],
    };
}

export function getSpeakers(format: SurroundFormat): SpeakerPosition[] {
    return FORMAT_SPEAKERS[format];
}

/**
 * VBAP pan coefficients for a source → speaker feeds.
 */
export function calculatePanCoefficients(azimuth: number, elevation: number, format: SurroundFormat): number[] {
    const speakers = FORMAT_SPEAKERS[format];
    const coeffs = Array.from({ length: speakers.length }).fill(0) as number[];
    const azRad = (azimuth * Math.PI) / 180;
    const elRad = (elevation * Math.PI) / 180;
    const sx = Math.cos(elRad) * Math.sin(azRad);
    const sy = Math.cos(elRad) * Math.cos(azRad);
    const sz = Math.sin(elRad);

    let total = 0;
    for (let i = 0; i < speakers.length; i++) {
        const sp = speakers[i]!;
        const a = (sp.azimuth * Math.PI) / 180;
        const e = (sp.elevation * Math.PI) / 180;
        const dot = sx * Math.cos(e) * Math.sin(a) + sy * Math.cos(e) * Math.cos(a) + sz * Math.sin(e);
        coeffs[i] = Math.max(0, (1 + dot) / 2);
        total += coeffs[i]! * coeffs[i]!;
    }
    if (total > 0) {
        const norm = 1 / Math.sqrt(total);
        for (let i = 0; i < coeffs.length; i++) {
            coeffs[i] = coeffs[i]! * norm;
        }
    }
    return coeffs;
}

export function getAvailableFormats(): SurroundFormat[] {
    return Object.keys(FORMAT_CHANNELS) as SurroundFormat[];
}
