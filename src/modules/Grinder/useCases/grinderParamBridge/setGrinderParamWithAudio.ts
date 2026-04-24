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

function getIndexedValue<Options extends readonly string[]>(options: Options, raw: number): Options[number] {
    const rounded = Math.round(raw);
    const safeIndex = Number.isFinite(rounded) ? Math.max(0, Math.min(options.length - 1, rounded)) : 0;
    return (options[safeIndex] ?? options[0]) as Options[number];
}

function toPatchValue<Key extends keyof GrinderPatch>(key: Key, value: number): GrinderPatch[Key] {
    if (BOOLEAN_PATCH_KEYS.has(key)) {
        return (value > 0.5) as GrinderPatch[Key];
    }

    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- intentional partial handler: only enum-valued keys need index-to-value conversion; boolean keys are handled by the guard above, and numeric keys fall to `default: return value`
    switch (key) {
        case 'engineMode':
            return getIndexedValue(ENGINE_MODES, value) as GrinderPatch[Key];
        case 'ampModel':
            return getIndexedValue(AMP_MODELS, value) as GrinderPatch[Key];
        case 'inputMode':
            return getIndexedValue(INPUT_MODES, value) as GrinderPatch[Key];
        case 'toneStackType':
            return getIndexedValue(TONE_STACK_TYPES, value) as GrinderPatch[Key];
        case 'powerTubeType':
            return getIndexedValue(POWER_TUBE_TYPES, value) as GrinderPatch[Key];
        case 'rectifierType':
            return getIndexedValue(RECTIFIER_TYPES, value) as GrinderPatch[Key];
        case 'neuralPlacement':
            return getIndexedValue(NEURAL_PLACEMENTS, value) as GrinderPatch[Key];
        case 'neuralTier':
            return getIndexedValue(NEURAL_TIERS, value) as GrinderPatch[Key];
        case 'routingMode':
            return getIndexedValue(ROUTING_MODES, value) as GrinderPatch[Key];
        default:
            return value as GrinderPatch[Key];
    }
}

export const setGrinderParamWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
    return function setGrinderParamWithAudio<Key extends keyof GrinderPatch>(
        deviceId: string,
        key: Key,
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
