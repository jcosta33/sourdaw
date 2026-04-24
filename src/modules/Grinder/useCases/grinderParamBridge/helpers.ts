import { type persistDeviceParam } from '#/modules/Arrangement/useCases';
import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import {
    GRINDER_NEURAL_LIBRARY,
    SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES,
    type GrinderPedal,
    type GrinderSupportedChainPedalType,
    getGrinderSupportedChainOrder,
} from '../../models/GrinderPatch';

import type { DeviceRef } from '#/utils/createFindDeviceRef';

export type { DeviceRef, GetAllTracksFn } from '#/utils/createFindDeviceRef';
export { createFindDeviceRef } from '#/utils/createFindDeviceRef';
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

export type GrinderBatchEntry = { ref: DeviceRef; key: string; value: number };
export const paramBatcher = createRafBatcher<GrinderBatchEntry>();

export function createFlushParam(updateDeviceParamFn: UpdateDeviceParamFn, persistDeviceParamFn: PersistDeviceParamFn) {
    return function flushParam(_compositeKey: string, entry: GrinderBatchEntry): void {
        updateDeviceParamFn(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        persistDeviceParamFn(entry.ref.deviceId, entry.key, entry.value);
    };
}

export function getAudioParamKeyForPedal(isPost: boolean, pedalType: string, paramKey: string): string | null {
    const prefix = isPost ? 'post' : 'pre';
    let pedalName: string;

    switch (pedalType) {
        case 'compressor':
            pedalName = 'Compressor';
            break;
        case 'overdrive':
        case 'boost':
            pedalName = 'Overdrive';
            break;
        case 'distortion':
            pedalName = 'Distortion';
            break;
        case 'fuzz':
            pedalName = 'Fuzz';
            break;
        default:
            return null;
    }

    const capitalizedParam = paramKey.charAt(0).toUpperCase() + paramKey.slice(1);
    return `${prefix}${pedalName}${capitalizedParam}`;
}

function getAudioOrderKeyForPedal(
    isPost: boolean,
    pedal_type: GrinderSupportedChainPedalType
): string {
    const prefix = isPost ? 'post' : 'pre';

    switch (pedal_type) {
        case 'compressor':
            return `${prefix}CompressorOrder`;
        case 'overdrive':
            return `${prefix}OverdriveOrder`;
        case 'distortion':
            return `${prefix}DistortionOrder`;
        case 'fuzz':
            return `${prefix}FuzzOrder`;
    }
}

export function getPedalOrderAudioEntries(
    isPost: boolean,
    pedals: readonly GrinderPedal[]
): Array<{ key: string; value: number }> {
    const order = getGrinderSupportedChainOrder(pedals);

    return SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES.map((pedal_type) => ({
        key: getAudioOrderKeyForPedal(isPost, pedal_type),
        value: order.indexOf(pedal_type),
    }));
}

export const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
export const ENGINE_MODES = ['circuit', 'capture', 'hybrid'] as const;
export const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
export const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
export const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
export const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
export const NEURAL_PLACEMENTS = ['amp-capture', 'rig-capture'] as const;
export const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;
export const ROUTING_MODES = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;

export function getNeuralModelSlot(neural_model_id: string): number | null {
    const slot = GRINDER_NEURAL_LIBRARY.findIndex((model) => model.id === neural_model_id);
    return slot >= 0 ? slot : null;
}
