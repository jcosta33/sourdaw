/**
 * Static catalog of available DDSP instrument models.
 *
 * Models are hosted by Google Magenta (TF.js GraphModel format).
 * Each entry is pinned to the complete direct-host artifact set, never a caller-supplied URL.
 */

import { type DdspInstrument } from './BrowserModel';
import { DDSP_ARTIFACTS, DDSP_CHECKPOINT_VERSION, type DdspArtifact } from './DdspArtifactManifest';

export type AdmittedDdspInstrument<
    TId extends string = string,
    TInstrument extends keyof typeof DDSP_ARTIFACTS = keyof typeof DDSP_ARTIFACTS,
> = Omit<DdspInstrument, 'id' | 'instrument' | 'status' | 'downloadProgress'> & {
    id: TId;
    instrument: TInstrument;
    artifactVersion: string;
    artifacts: readonly DdspArtifact[];
};

function entry<TId extends string, TInstrument extends keyof typeof DDSP_ARTIFACTS>(
    id: TId,
    name: string,
    instrument: TInstrument
): AdmittedDdspInstrument<TId, TInstrument> {
    const artifacts = DDSP_ARTIFACTS[instrument];
    const entryArtifact = artifacts[0];
    if (entryArtifact === undefined) {
        throw new Error(`DDSP artifact manifest is empty: ${instrument}`);
    }
    return Object.freeze({
        id,
        name,
        family: 'ddsp',
        instrument,
        url: entryArtifact.url,
        sizeBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
        license: 'Unverified',
        attribution: 'Magenta.js DDSP checkpoint — direct runtime download from Magenta.',
        nativeSampleRate: 16_000,
        frameRate: 250,
        artifacts,
        artifactVersion: DDSP_CHECKPOINT_VERSION,
    });
}

/** Factory DDSP catalog. It is intentionally not release admission. */
export const DDSP_INSTRUMENT_CATALOG = Object.freeze([
    entry('ddsp-violin', 'Violin', 'violin'),
    entry('ddsp-flute', 'Flute', 'flute'),
    entry('ddsp-trumpet', 'Trumpet', 'trumpet'),
    entry('ddsp-tenor-saxophone', 'Tenor Saxophone', 'tenor_saxophone'),
]);

export type DdspInstrumentId = (typeof DDSP_INSTRUMENT_CATALOG)[number]['id'];

/** Resolve only pinned release metadata; callers cannot supply artifact fields. */
export function resolveDdspInstrument(id: DdspInstrumentId): AdmittedDdspInstrument {
    const instrument = DDSP_INSTRUMENT_CATALOG.find((candidate) => candidate.id === id);
    if (instrument === undefined) {
        throw new Error(`DDSP instrument is not admitted: ${id}`);
    }
    return instrument;
}
