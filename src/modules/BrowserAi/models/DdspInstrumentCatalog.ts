/**
 * Static catalog of available DDSP instrument models.
 *
 * Models are hosted by Google Magenta (TF.js GraphModel format).
 * Base URL: https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/{instrument}
 * TF.js loadGraphModel() receives the directory URL and appends /model.json automatically.
 *
 * Available instruments confirmed via HTTP 200 (2025-04):
 * violin, flute, trumpet, tenor_saxophone
 */

import { type DdspInstrument } from './BrowserModel';

const DDSP_BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp';

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
        license: 'Unverified',
        attribution: 'DDSP checkpoint provenance pending',
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
        license: 'Unverified',
        attribution: 'DDSP checkpoint provenance pending',
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
        license: 'Unverified',
        attribution: 'DDSP checkpoint provenance pending',
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
        license: 'Unverified',
        attribution: 'DDSP checkpoint provenance pending',
        nativeSampleRate: 16000,
        frameRate: 250,
    },
];
