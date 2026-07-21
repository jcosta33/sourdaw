import { type persistDeviceParam, type resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type GrinderNeuralProfile, type GrinderSupportedChainPedalType } from '../../models/GrinderPatch';

export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;
export type ResolveEligibleDeviceWriteTargetFn = typeof resolveEligibleDeviceWriteTarget;

export type GrinderBatchEntry = { deviceId: string; key: string; value: number };
export const paramBatcher = createRafBatcher<GrinderBatchEntry>();

export const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
export const ENGINE_MODES = ['circuit', 'capture', 'hybrid'] as const;
export const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
export const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
export const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
export const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
export const CAB_TYPES = ['ir', 'parametric', 'both'] as const;
export const NEURAL_PLACEMENTS = ['amp-capture', 'rig-capture'] as const;
export const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;
export const ROUTING_MODES = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;

export type GrinderNeuralAudioPatch = {
    neuralModelMode: 'builtin' | 'imported';
    profile?: GrinderNeuralProfile;
};

/**
 * Single source of truth for the parameter values a supported drive pedal carries
 * when the patch does not already define it. Both the audio sync path
 * (syncGrinderPatchToAudio) and the panel's DRIVE_CONTROLS read from here so the
 * worklet and the visible UI agree on the same numbers.
 */
export const DEFAULT_GRINDER_PEDAL_PARAMS = {
    compressor: { threshold: -24, ratio: 3, attack: 16, release: 220 },
    overdrive: { drive: 2.8, tone: 5.2, level: 5.4 },
    distortion: { drive: 5.2, tone: 4.4, level: 7.2 },
    fuzz: { fuzz: 6.8, tone: 4.8, level: 6.4 },
} as const satisfies Record<GrinderSupportedChainPedalType, Record<string, number>>;
