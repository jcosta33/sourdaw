import { describe, expect, it } from 'vitest';

import { NATIVE_DSP_DESCRIPTORS } from '../NativeDspDescriptors';

/**
 * Pins the declared range of the `dutch-oven` algorithm selector to the wire
 * values the product can actually produce.
 *
 * What this range does and does not do is worth stating, because the number
 * reads like a safety check and is not one. No code clamps or rejects a device
 * parameter write against its descriptor; the write path's only guard is
 * `Number.isFinite`. `maxValue` feeds the modulation clamp and the automation
 * lane picker, and nothing else. The engine dispatch in
 * `crates/proof-chamber/src/lib.rs` is what actually decides which values are
 * safe to act on, and it is what stops 4 and 5 — the two convolution-backed
 * engines, which have no impulse response to render — from engaging.
 *
 * So this assertion is about the range being honest, not about it being
 * enforcing: it declared `maxValue: 5`, which was one short of what the engine
 * accepted and two beyond what the UI could produce, and matched neither.
 */
describe('dutch-oven algorithm range', () => {
    const dutchOven = NATIVE_DSP_DESCRIPTORS.find((descriptor) => descriptor.id === 'dutch-oven');
    const algorithm = dutchOven?.parameters.find((param) => param.id === 'algorithm');

    it('declares an integer selector defaulting to the plate algorithm', () => {
        expect(algorithm?.type).toBe('int');
        expect(algorithm?.defaultValue).toBe(0);
        expect(algorithm?.minValue).toBe(0);
    });

    it('covers every wire value the selector can produce, including reverse at 6', () => {
        expect(algorithm?.maxValue).toBe(6);
    });

    it('stays off the automation lane, which cannot express a discrete engine swap', () => {
        expect(algorithm?.automatable).toBe(false);
    });
});
