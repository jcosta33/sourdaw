import { BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_DYNAMICS } from './BuiltinEffectDescriptorsGuidanceDynamics';
import { BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TIME_AND_SPACE } from './BuiltinEffectDescriptorsGuidanceTimeAndSpace';
import { BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TONE } from './BuiltinEffectDescriptorsGuidanceTone';

/**
 * Per-parameter guidance declarations for the built-in effect descriptors
 * (EQ, Compressor, Reverb, Delay, and the rest of the stock device catalog).
 *
 * Split out of BuiltinEffectDescriptors.ts to keep both files under the
 * repository's max-lines ceiling; this file owns only the guidance data,
 * never descriptor parameter shape. The table itself is further split by
 * device family across `BuiltinEffectDescriptorsGuidanceDynamics.ts`,
 * `BuiltinEffectDescriptorsGuidanceTone.ts`, and
 * `BuiltinEffectDescriptorsGuidanceTimeAndSpace.ts`, because the built-in
 * catalog covers far more devices than the Faust or native DSP guidance
 * tables and the combined declarations alone exceed the max-lines ceiling.
 * A new built-in device's guidance goes in the file of its family.
 */
export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE = [
    ...BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_DYNAMICS,
    ...BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TONE,
    ...BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TIME_AND_SPACE,
];
