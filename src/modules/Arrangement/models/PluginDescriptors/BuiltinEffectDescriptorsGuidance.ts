import { BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_PRIMARY } from './BuiltinEffectDescriptorsGuidancePrimary';
import { BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_SECONDARY } from './BuiltinEffectDescriptorsGuidanceSecondary';

/**
 * Per-parameter guidance declarations for the built-in effect descriptors
 * (EQ, Compressor, Reverb, Delay, and the rest of the stock device catalog).
 *
 * Split out of BuiltinEffectDescriptors.ts to keep both files under the
 * repository's max-lines ceiling; this file owns only the guidance data,
 * never descriptor parameter shape. The table itself is further split
 * across `BuiltinEffectDescriptorsGuidancePrimary.ts` and
 * `BuiltinEffectDescriptorsGuidanceSecondary.ts` because the built-in
 * catalog covers far more devices than the Faust or native DSP guidance
 * tables, and the combined declarations alone exceed the max-lines ceiling.
 */
export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE = [
    ...BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_PRIMARY,
    ...BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_SECONDARY,
];
