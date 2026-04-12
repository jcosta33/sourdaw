import { persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
export type { DeviceRef, GetAllTracksFn } from '#/utils/createFindDeviceRef';
export { createFindDeviceRef } from '#/utils/createFindDeviceRef';
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

export const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
export const ENGINE_MODES = ['circuit', 'capture', 'hybrid'] as const;
export const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
export const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
export const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
export const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
export const NEURAL_PLACEMENTS = ['amp-capture', 'rig-capture'] as const;
export const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;
export const ROUTING_MODES = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;