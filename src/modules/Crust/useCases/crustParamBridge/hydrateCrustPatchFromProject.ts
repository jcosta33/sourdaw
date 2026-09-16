import { trackStore } from '#/modules/Arrangement/stores';

import { asCrustOversampleFactor, type CrustPatch } from '../../models/CrustPatch';
import { getCrustState, loadCrustPatch } from '../../stores/crustStore';

import {
    ALGORITHM_INDEX,
    DITHER_INDEX,
    MULTIBAND_INDEX,
    SAT_ALGORITHM_INDEX,
    SCROLL_SPEED_INDEX,
    STEREO_MODE_INDEX,
    STYLE_INDEX,
} from './helpers';

const STYLE_NAMES = Object.keys(STYLE_INDEX);
const ALGORITHM_NAMES = Object.keys(ALGORITHM_INDEX);
const SAT_ALGORITHM_NAMES = Object.keys(SAT_ALGORITHM_INDEX);
const MULTIBAND_NAMES = Object.keys(MULTIBAND_INDEX);
const STEREO_MODE_NAMES = Object.keys(STEREO_MODE_INDEX);
const DITHER_NAMES = Object.keys(DITHER_INDEX);
const SCROLL_SPEED_NAMES = Object.keys(SCROLL_SPEED_INDEX);

function nameAt(names: readonly string[], stored: number | undefined): string | null {
    if (stored === undefined || !Number.isInteger(stored) || stored < 0 || stored >= names.length) {
        return null;
    }
    return names[stored] ?? null;
}

const NUMERIC_FIELDS = [
    'gain',
    'ceiling',
    'lookahead',
    'attack',
    'release',
    'channelLinkTransient',
    'channelLinkRelease',
    'satDrive',
    'satMix',
    'crossover1',
    'crossover2',
    'scHpfFreq',
] as const satisfies readonly (keyof CrustPatch)[];

const BOOLEAN_FIELDS = [
    'attackAuto',
    'releaseAuto',
    'truePeak',
    'satEnabled',
    'deltaListen',
    'unityGain',
    'scHpfEnabled',
] as const satisfies readonly (keyof CrustPatch)[];

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isStoredTrue(stored: number): boolean {
    return stored > 0.5;
}

/**
 * The project's `parameterValues` record is the engine's numeric encoding (the
 * same numbers `persistDeviceParam` writes), so every enum name here is read
 * back through the index tables the encoder owns. A stored number outside a
 * table leaves that field at its current patch value rather than inventing a
 * neighbour — a corrupt record must not be silently reinterpreted.
 */
function withGlobalFields(patch: CrustPatch, parameterValues: Record<string, number>): CrustPatch {
    let next = patch;

    for (const field of NUMERIC_FIELDS) {
        const stored = parameterValues[field];
        if (isFiniteNumber(stored) && !Object.is(next[field], stored)) {
            next = { ...next, [field]: stored };
        }
    }

    for (const field of BOOLEAN_FIELDS) {
        const stored = parameterValues[field];
        if (isFiniteNumber(stored) && !Object.is(next[field], isStoredTrue(stored))) {
            next = { ...next, [field]: isStoredTrue(stored) };
        }
    }

    return next;
}

type EnumField = 'style' | 'algorithm' | 'satAlgorithm' | 'multiBand' | 'stereoMode' | 'dither' | 'scrollSpeed';

const ENUM_FIELD_NAMES: Readonly<Record<EnumField, readonly string[]>> = {
    style: STYLE_NAMES,
    algorithm: ALGORITHM_NAMES,
    satAlgorithm: SAT_ALGORITHM_NAMES,
    multiBand: MULTIBAND_NAMES,
    stereoMode: STEREO_MODE_NAMES,
    dither: DITHER_NAMES,
    scrollSpeed: SCROLL_SPEED_NAMES,
};

function withEnumFields(patch: CrustPatch, parameterValues: Record<string, number>): CrustPatch {
    let next = patch;
    for (const field of Object.keys(ENUM_FIELD_NAMES) as EnumField[]) {
        const name = nameAt(ENUM_FIELD_NAMES[field], parameterValues[field]);
        if (name !== null && next[field] !== name) {
            next = { ...next, [field]: name };
        }
    }
    return next;
}

function withStoredOversampling(patch: CrustPatch, storedOversampling: number | undefined): CrustPatch {
    if (!Number.isFinite(storedOversampling)) {
        return patch;
    }
    // Oversampling is membership-resolved against the declared factor set, the
    // same law `loadCrustPatchWithAudio` asks of the Arrangement descriptor: a
    // stored number outside the set leaves the current patch value alone rather
    // than loading the number nobody is playing.
    const declared = asCrustOversampleFactor(storedOversampling as number);
    if (declared === null || declared === patch.oversampling) {
        return patch;
    }
    return { ...patch, oversampling: declared };
}

function withStoredBitDepth(patch: CrustPatch, storedBitDepth: number | undefined): CrustPatch {
    if (storedBitDepth === 16 || storedBitDepth === 24 || storedBitDepth === 32) {
        if (patch.outputBitDepth === storedBitDepth) {
            return patch;
        }
        return { ...patch, outputBitDepth: storedBitDepth };
    }
    return patch;
}

/**
 * Re-project the device's own store slice from its persisted `parameterValues`
 * (#3673): the store holds defaults until the panel's first write, so a
 * reloaded project — and any command, undo, or collaborator write that changes
 * project truth without this panel's setter — must reach the visible controls
 * through this read-only projection. Same inbound pattern as Gluten's
 * `hydrateGlutenPatchFromProject`.
 */
export function hydrateCrustPatchFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }
    const parameterValues = device.parameterValues ?? {};

    const currentPatch = getCrustState(deviceId).patch;
    let patch = withGlobalFields(currentPatch, parameterValues);
    patch = withEnumFields(patch, parameterValues);
    patch = withStoredOversampling(patch, parameterValues.oversampling);
    patch = withStoredBitDepth(patch, parameterValues.outputBitDepth);

    if (patch !== currentPatch) {
        loadCrustPatch(deviceId, patch);
    }
}
