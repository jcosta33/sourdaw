import { inject } from '#/infra/di/inject';

import { type GrinderPatch } from '../../models/GrinderPatch';
import { setGrinderParam } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import {
    AMP_MODELS,
    ENGINE_MODES,
    INPUT_MODES,
    NEURAL_PLACEMENTS,
    NEURAL_TIERS,
    POWER_TUBE_TYPES,
    RECTIFIER_TYPES,
    ROUTING_MODES,
    TONE_STACK_TYPES,
    createFindDeviceRef,
    createFlushParam,
    paramBatcher,
} from './helpers';

const BOOLEAN_PATCH_KEYS: ReadonlySet<keyof GrinderPatch> = new Set([
    'gateEnabled',
    'bright',
    'fat',
    'brightCap',
    'cabEnabled',
    'cabOpenBack',
    'neuralEnabled',
    'limiterEnabled',
]);

function getIndexedValue<T extends readonly string[]>(options: T, raw: number): T[number] {
    const rounded = Math.round(raw);
    const safeIndex = Number.isFinite(rounded) ? Math.max(0, Math.min(options.length - 1, rounded)) : 0;
    return (options[safeIndex] ?? options[0]) as T[number];
}

function toPatchValue<K extends keyof GrinderPatch>(key: K, value: number): GrinderPatch[K] {
    if (BOOLEAN_PATCH_KEYS.has(key)) {
        return (value > 0.5) as GrinderPatch[K];
    }

    switch (key) {
        case 'engineMode':
            return getIndexedValue(ENGINE_MODES, value) as GrinderPatch[K];
        case 'ampModel':
            return getIndexedValue(AMP_MODELS, value) as GrinderPatch[K];
        case 'inputMode':
            return getIndexedValue(INPUT_MODES, value) as GrinderPatch[K];
        case 'toneStackType':
            return getIndexedValue(TONE_STACK_TYPES, value) as GrinderPatch[K];
        case 'powerTubeType':
            return getIndexedValue(POWER_TUBE_TYPES, value) as GrinderPatch[K];
        case 'rectifierType':
            return getIndexedValue(RECTIFIER_TYPES, value) as GrinderPatch[K];
        case 'neuralPlacement':
            return getIndexedValue(NEURAL_PLACEMENTS, value) as GrinderPatch[K];
        case 'neuralTier':
            return getIndexedValue(NEURAL_TIERS, value) as GrinderPatch[K];
        case 'routingMode':
            return getIndexedValue(ROUTING_MODES, value) as GrinderPatch[K];
        default:
            return value as GrinderPatch[K];
    }
}

export const setGrinderParamWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
    return function setGrinderParamWithAudio<K extends keyof GrinderPatch>(
        deviceId: string,
        key: K,
        value: number
    ): void {
        const patchValue = toPatchValue(key, value);
        setGrinderParam(deviceId, key, patchValue);
        if (key === 'engineMode') {
            setGrinderParam(deviceId, 'neuralEnabled', patchValue !== 'circuit');
        } else if (key === 'neuralEnabled') {
            setGrinderParam(deviceId, 'engineMode', (patchValue ? 'hybrid' : 'circuit') as GrinderPatch['engineMode']);
        }

        const ref = findDeviceRef(deviceId);
        if (!ref) {
            return;
        }

        const compositeKey = `${deviceId}:${key}`;
        paramBatcher.schedule(compositeKey, { ref, key, value }, flushParam);
    };
});
