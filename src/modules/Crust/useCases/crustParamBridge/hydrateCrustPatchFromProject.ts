import { trackStore } from '#/modules/Arrangement/stores';

import { CRUST_PARAM_IDS } from '../../models/CrustParamIds';
import {
    asCrustOversampleFactor,
    crustDisclosureLevelFromState,
    DEFAULT_CRUST_PATCH,
    type CrustPatch,
} from '../../models/CrustPatch';
import { getCrustState, loadCrustPatch } from '../../stores/crustStore';

import { algorithmFromStyle } from './algorithmFromStyle';
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
    CRUST_PARAM_IDS.gain,
    CRUST_PARAM_IDS.ceiling,
    CRUST_PARAM_IDS.lookahead,
    CRUST_PARAM_IDS.attack,
    CRUST_PARAM_IDS.release,
    CRUST_PARAM_IDS.channelLinkTransient,
    CRUST_PARAM_IDS.channelLinkRelease,
    CRUST_PARAM_IDS.satDrive,
    CRUST_PARAM_IDS.satMix,
    CRUST_PARAM_IDS.crossover1,
    CRUST_PARAM_IDS.crossover2,
    CRUST_PARAM_IDS.scHpfFreq,
] as const satisfies readonly (keyof CrustPatch)[];

const BOOLEAN_FIELDS = [
    CRUST_PARAM_IDS.attackAuto,
    CRUST_PARAM_IDS.releaseAuto,
    CRUST_PARAM_IDS.truePeak,
    CRUST_PARAM_IDS.satEnabled,
    CRUST_PARAM_IDS.deltaListen,
    CRUST_PARAM_IDS.unityGain,
    CRUST_PARAM_IDS.scHpfEnabled,
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
function withGlobalFields(
    patch: CrustPatch,
    parameterValues: Record<string, number>,
    restorePresetDefaults: boolean
): CrustPatch {
    let next = patch;

    for (const field of NUMERIC_FIELDS) {
        const stored = Object.hasOwn(parameterValues, field) ? parameterValues[field] : DEFAULT_CRUST_PATCH[field];
        if (isFiniteNumber(stored) && !Object.is(next[field], stored)) {
            next = { ...next, [field]: stored };
        }
    }

    for (const field of BOOLEAN_FIELDS) {
        let stored = parameterValues[field];
        if (restorePresetDefaults && !Object.hasOwn(parameterValues, field)) {
            stored = Number(DEFAULT_CRUST_PATCH[field]);
        }
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

function absentEnumValue(field: EnumField, patch: CrustPatch): string {
    if (field === 'algorithm') {
        return algorithmFromStyle(patch.style) ?? DEFAULT_CRUST_PATCH.algorithm;
    }
    return field === 'scrollSpeed' ? patch.scrollSpeed : DEFAULT_CRUST_PATCH[field];
}

function withEnumFields(
    patch: CrustPatch,
    parameterValues: Record<string, number>,
    restorePresetDefaults: boolean
): CrustPatch {
    let next = patch;
    for (const field of Object.keys(ENUM_FIELD_NAMES) as EnumField[]) {
        let name: string | null = null;
        if (Object.hasOwn(parameterValues, field)) {
            name = nameAt(ENUM_FIELD_NAMES[field], parameterValues[field]);
        } else if (restorePresetDefaults || (field === 'algorithm' && Object.hasOwn(parameterValues, 'style'))) {
            name = absentEnumValue(field, next);
        }
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
    // same law the preset encoder asks of the Arrangement descriptor: a
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

function readCrustDevice(deviceId: string) {
    return trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'crust');
}

function withOwnedPreviews(patch: CrustPatch, ownedPreviews: ReadonlyMap<keyof CrustPatch, number>): CrustPatch {
    let next = patch;
    for (const [key, value] of ownedPreviews) {
        if (typeof DEFAULT_CRUST_PATCH[key] === 'number') {
            next = { ...next, [key]: value };
        }
    }
    return next;
}

/**
 * Re-project the device's own store slice from its persisted `parameterValues`
 * (#3673): the store holds defaults until the panel's first write, so a
 * reloaded project — and any command, undo, or collaborator write that changes
 * project truth without this panel's setter — must reach the visible controls
 * through this read-only projection. Same inbound pattern as Gluten's
 * `hydrateGlutenPatchFromProject`.
 */
export function hydrateCrustPatchFromProject(
    deviceId: string,
    ownedPreviews: ReadonlyMap<keyof CrustPatch, number> = new Map(),
    presetMetadata?: Pick<CrustPatch, 'name' | 'streamingPreset'>
): void {
    const device = readCrustDevice(deviceId);
    if (!device) {
        return;
    }
    const parameterValues = device.parameterValues ?? {};

    const currentPatch = getCrustState(deviceId).patch;
    // The regular projection can observe a queued enum or switch gesture before its frame writes.
    // Only committed preset replay restores those missing controls to their engine defaults.
    const restorePresetDefaults = presetMetadata !== undefined;
    let patch = withGlobalFields(currentPatch, parameterValues, restorePresetDefaults);
    if (
        presetMetadata &&
        (patch.name !== presetMetadata.name || patch.streamingPreset !== presetMetadata.streamingPreset)
    ) {
        patch = { ...patch, name: presetMetadata.name, streamingPreset: presetMetadata.streamingPreset };
    }
    patch = withEnumFields(patch, parameterValues, restorePresetDefaults);
    patch = withStoredOversampling(
        patch,
        Object.hasOwn(parameterValues, CRUST_PARAM_IDS.oversampling)
            ? parameterValues[CRUST_PARAM_IDS.oversampling]
            : DEFAULT_CRUST_PATCH.oversampling
    );
    patch = withStoredBitDepth(
        patch,
        Object.hasOwn(parameterValues, CRUST_PARAM_IDS.outputBitDepth)
            ? parameterValues[CRUST_PARAM_IDS.outputBitDepth]
            : DEFAULT_CRUST_PATCH.outputBitDepth
    );
    patch = withOwnedPreviews(patch, ownedPreviews);
    const uiLevel = crustDisclosureLevelFromState(device.deviceState);
    if (patch.uiLevel !== uiLevel) {
        patch = { ...patch, uiLevel };
    }

    if (patch !== currentPatch) {
        loadCrustPatch(deviceId, patch);
    }
}
