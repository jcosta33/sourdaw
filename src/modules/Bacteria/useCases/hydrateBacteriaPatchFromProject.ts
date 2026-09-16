import { trackStore } from '#/modules/Arrangement/stores';

import {
    type BacteriaBand,
    type BacteriaCrossoverMode,
    type BacteriaDistortionMode,
    type BacteriaFilterMode,
    type BacteriaGrainWindow,
    type BacteriaPatch,
    type BacteriaRoutingMode,
} from '../models/BacteriaPatch';
import { getBacteriaState, loadBacteriaPatch } from '../stores/bacteriaStore';

import {
    CROSSOVER_MODE_INDEX,
    DISTORTION_MODE_INDEX,
    FILTER_MODE_INDEX,
    GRAIN_WINDOW_INDEX,
    ROUTING_MODE_INDEX,
} from './bacteriaParamBridge/helpers';

/**
 * Reverse index tables for the bridge's mode encodings. `parameterValues`
 * holds what `persistDeviceParam` wrote — the engine's numbers — so an enum
 * field is read back through the same tables `encodePatchValue` writes with.
 * A stored index outside a table leaves that field at its current value: a
 * corrupt record must not be silently reinterpreted as mode 0.
 */
const CROSSOVER_MODE_NAMES = Object.keys(CROSSOVER_MODE_INDEX);
const DISTORTION_MODE_NAMES = Object.keys(DISTORTION_MODE_INDEX);
const FILTER_MODE_NAMES = Object.keys(FILTER_MODE_INDEX);
const GRAIN_WINDOW_NAMES = Object.keys(GRAIN_WINDOW_INDEX);
const ROUTING_MODE_NAMES = Object.keys(ROUTING_MODE_INDEX);

function nameAt(names: readonly string[], stored: number | undefined): string | null {
    if (!isFiniteNumber(stored) || !Number.isInteger(stored) || stored < 0 || stored >= names.length) {
        return null;
    }
    return names[stored] ?? null;
}

const NUMERIC_GLOBAL_FIELDS = [
    'mix',
    'outputGain',
    'inputGain',
    'bandCount',
    'crossoverFreq1',
    'crossoverFreq2',
    'crossoverFreq3',
    'crossoverFreq4',
    'crossoverFreq5',
    'crossoverSlope',
    'macro1',
    'macro2',
    'macro3',
    'macro4',
    'macro5',
    'macro6',
    'macro7',
    'macro8',
    'lfo1Rate',
    'lfo1Shape',
    'lfo1Amount',
    'lfo2Rate',
    'lfo2Shape',
    'lfo2Amount',
    'envFollowerAttack',
    'envFollowerRelease',
    'stepSeqSteps',
    'stepSeqRate',
    'lorenzSigma',
    'lorenzRho',
    'lorenzBeta',
    'lorenzSpeed',
] as const satisfies readonly (keyof BacteriaPatch)[];

const BOOLEAN_GLOBAL_FIELDS = ['bypass', 'lfo1Sync', 'lfo2Sync'] as const satisfies readonly (keyof BacteriaPatch)[];

const NUMERIC_BAND_FIELDS = [
    'gain',
    'oversampling',
    'drive',
    'asymmetry',
    'foldbackThreshold',
    'bitDepth',
    'sampleRateReduce',
    'tubeBias',
    'breakdownDepth',
    'filterCutoff',
    'filterResonance',
    'filterEnvAmount',
    'filterEnvAttack',
    'filterEnvRelease',
    'chorusRate',
    'chorusDepth',
    'chorusFeedback',
    'chorusMix',
    'phaserRate',
    'phaserDepth',
    'phaserFeedback',
    'phaserMix',
    'grainSize',
    'grainDensity',
    'grainPosOffset',
    'grainPitch',
    'grainMix',
    'spectralBlur',
    'spectralMix',
    'freqShiftHz',
    'freqShiftMix',
    'lofiAmount',
    'codecArtifact',
    'convolutionMix',
    'convolutionSeparation',
] as const satisfies readonly (keyof BacteriaBand)[];

const BOOLEAN_BAND_FIELDS = [
    'enabled',
    'solo',
    'mute',
    'distortionEnabled',
    'filterEnabled',
    'granularEnabled',
    'spectralEnabled',
    'modulationEnabled',
    'convolutionEnabled',
    'freqShiftEnabled',
    'chorusEnabled',
    'lofiEnabled',
    'phaserEnabled',
    'grainFreeze',
    'spectralFreeze',
] as const satisfies readonly (keyof BacteriaBand)[];

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** The bridge persists booleans as its 0/1 encoding; 0.5 is the decode threshold. */
function isStoredTrue(stored: number): boolean {
    return stored > 0.5;
}

/**
 * Hydrate the Bacteria session store from the device's persisted
 * `parameterValues` (#3673).
 *
 * The panel store holds defaults until its own first write, so a project
 * loaded with nondefault parameters — and any later command, undo, or
 * collaborator write that changes project truth without this panel's setter —
 * left the visible controls describing a patch nobody is hearing. This is the
 * same inbound projection the Fermenter and Gluten panels run: read-only, from
 * project state, into the owning store.
 */
export function hydrateBacteriaPatchFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device || device.type !== 'bacteria' || !device.parameterValues) {
        return;
    }
    const parameterValues = device.parameterValues;

    let patch = getBacteriaState(deviceId).patch;
    let changed = false;

    for (const field of NUMERIC_GLOBAL_FIELDS) {
        const stored = parameterValues[field];
        if (isFiniteNumber(stored) && !Object.is(patch[field], stored)) {
            patch = { ...patch, [field]: stored };
            changed = true;
        }
    }

    for (const field of BOOLEAN_GLOBAL_FIELDS) {
        const stored = parameterValues[field];
        if (isFiniteNumber(stored) && !Object.is(patch[field], isStoredTrue(stored))) {
            patch = { ...patch, [field]: isStoredTrue(stored) };
            changed = true;
        }
    }

    for (let bandIndex = 0; bandIndex < patch.bands.length; bandIndex++) {
        const hydrated = hydrateBandFromProject(patch.bands[bandIndex]!, bandIndex, parameterValues);
        if (hydrated !== patch.bands[bandIndex]) {
            patch = { ...patch, bands: patch.bands.map((band, index) => (index === bandIndex ? hydrated : band)) };
            changed = true;
        }
    }

    const crossoverMode = nameAt(CROSSOVER_MODE_NAMES, parameterValues.crossoverMode);
    if (crossoverMode !== null && patch.crossoverMode !== crossoverMode) {
        patch = { ...patch, crossoverMode: crossoverMode as BacteriaCrossoverMode };
        changed = true;
    }

    const globalRouting = nameAt(ROUTING_MODE_NAMES, parameterValues.globalRouting);
    if (globalRouting !== null && patch.globalRouting !== globalRouting) {
        patch = { ...patch, globalRouting: globalRouting as BacteriaRoutingMode };
        changed = true;
    }

    if (changed) {
        loadBacteriaPatch(deviceId, patch);
    }
}

function hydrateBandFromProject(
    band: BacteriaBand,
    bandIndex: number,
    parameterValues: Record<string, number>
): BacteriaBand {
    let next = band;
    const storedBandValue = (key: string): number | undefined => parameterValues[`band${bandIndex}_${key}`];

    for (const field of NUMERIC_BAND_FIELDS) {
        const stored = storedBandValue(field);
        if (isFiniteNumber(stored) && !Object.is(next[field], stored)) {
            next = { ...next, [field]: stored };
        }
    }

    for (const field of BOOLEAN_BAND_FIELDS) {
        const stored = storedBandValue(field);
        if (isFiniteNumber(stored) && !Object.is(next[field], isStoredTrue(stored))) {
            next = { ...next, [field]: isStoredTrue(stored) };
        }
    }

    const distortionMode = nameAt(DISTORTION_MODE_NAMES, storedBandValue('distortionMode'));
    if (distortionMode !== null && next.distortionMode !== distortionMode) {
        next = { ...next, distortionMode: distortionMode as BacteriaDistortionMode };
    }

    const filterMode = nameAt(FILTER_MODE_NAMES, storedBandValue('filterMode'));
    if (filterMode !== null && next.filterMode !== filterMode) {
        next = { ...next, filterMode: filterMode as BacteriaFilterMode };
    }

    const grainWindow = nameAt(GRAIN_WINDOW_NAMES, storedBandValue('grainWindow'));
    if (grainWindow !== null && next.grainWindow !== grainWindow) {
        next = { ...next, grainWindow: grainWindow as BacteriaGrainWindow };
    }

    const routingMode = nameAt(ROUTING_MODE_NAMES, storedBandValue('routingMode'));
    if (routingMode !== null && next.routingMode !== routingMode) {
        next = { ...next, routingMode: routingMode as BacteriaRoutingMode };
    }

    return next;
}
