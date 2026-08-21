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
import { DDSP_ARTIFACTS, DDSP_CHECKPOINT_VERSION, type DdspArtifact } from './DdspArtifactManifest';

/**
 * Factory DDSP instrument catalog.
 */
function entry(
    id: string,
    name: string,
    instrument: keyof typeof DDSP_ARTIFACTS
): Omit<DdspInstrument, 'status' | 'downloadProgress'> {
    const artifacts = DDSP_ARTIFACTS[instrument];
    return {
        id,
        name,
        family: 'ddsp',
        instrument,
        url: artifacts[0]!.url,
        sizeBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
        license: 'Unverified',
        attribution: 'Magenta.js DDSP checkpoint — direct runtime download from Magenta.',
        nativeSampleRate: 16_000,
        frameRate: 250,
        artifacts: [...artifacts],
        artifactVersion: DDSP_CHECKPOINT_VERSION,
    };
}

export const DDSP_INSTRUMENT_CATALOG = [
    entry('ddsp-violin', 'Violin', 'violin'),
    entry('ddsp-flute', 'Flute', 'flute'),
    entry('ddsp-trumpet', 'Trumpet', 'trumpet'),
    entry('ddsp-tenor-saxophone', 'Tenor Saxophone', 'tenor_saxophone'),
] as const;

export type DdspInstrumentId = (typeof DDSP_INSTRUMENT_CATALOG)[number]['id'];
export type AdmittedDdspInstrument = Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: DdspArtifact[];
};

/** Resolve only release-admitted checkpoint metadata; callers never provide it. */
export function resolveDdspInstrument(id: DdspInstrumentId): AdmittedDdspInstrument {
    const instrument = DDSP_INSTRUMENT_CATALOG.find((candidate) => candidate.id === id);
    if (instrument === undefined) {
        throw new Error(`DDSP instrument is not admitted: ${id}`);
    }
    return instrument as AdmittedDdspInstrument;
}
