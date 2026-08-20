import { describe, expect, it } from 'vitest';

import { NATIVE_DSP_DEVICE_TYPES, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

import { findReleasedNativeDspDeviceFactory } from '../findReleasedNativeDspDeviceFactory';
import { isNativeDspDevice, NATIVE_DSP_DEVICE_FACTORIES } from '../nativeDspDeviceFactories';

/**
 * The factory list decides which device types can be *built* offline;
 * `NATIVE_DSP_DEVICE_TYPES` is what the composition root's hydration table is
 * exhaustive over. If those two sets drift, a device becomes buildable without
 * anyone being forced to decide whether it needs hydration — which is exactly the
 * hole the table exists to close, reopened one level up.
 *
 * `tsc` already stops a factory declaring a type outside the union. These assert
 * the two directions a type cannot check: that a declared type is one the
 * factory's own predicate accepts, and that no canonical type is left unbuilt.
 */
describe('native DSP device types are welded to the factory list', () => {
    it('every factory declares a type its own matcher accepts', () => {
        const mismatched = NATIVE_DSP_DEVICE_FACTORIES.filter((factory) => !factory.matches(factory.type)).map(
            (factory) => factory.type
        );

        expect(mismatched).toEqual([]);
    });

    it('no factory claims another factory’s declared type', () => {
        // Overlapping matchers would make `find` order-dependent, so the type a
        // device resolves to would depend on list position rather than identity.
        const overlaps: string[] = [];
        for (const factory of NATIVE_DSP_DEVICE_FACTORIES) {
            for (const other of NATIVE_DSP_DEVICE_FACTORIES) {
                if (other !== factory && other.matches(factory.type)) {
                    overlaps.push(`${other.type} also claims ${factory.type}`);
                }
            }
        }

        expect(overlaps).toEqual([]);
    });

    it('the factory list and the canonical list describe the same set', () => {
        const declared = NATIVE_DSP_DEVICE_FACTORIES.map((factory) => factory.type).sort();

        expect(declared).toEqual([...NATIVE_DSP_DEVICE_TYPES].sort());
    });

    it('every canonical type is one the offline path will actually build', () => {
        const unbuildable = NATIVE_DSP_DEVICE_TYPES.filter((type) => !isNativeDspDevice(type));

        expect(unbuildable).toEqual([]);
    });

    it('keeps withheld implementations out of released offline rendering', () => {
        expect(isNativeDspDevice('grand-boule')).toBe(true);
        expect(findReleasedNativeDspDeviceFactory('grand-boule')).toBeUndefined();
    });

    it('the resolver and the factory matchers agree on what is native', () => {
        // Both directions, so neither list can grow an entry the other rejects.
        const disagreements = [...NATIVE_DSP_DEVICE_TYPES, 'synth', 'builtin-drum-kit', 'external-plugin', 'Knead']
            .map((type) => ({
                type,
                resolved: resolveNativeDspDeviceType(type) !== null,
                built: isNativeDspDevice(type),
            }))
            .filter((row) => row.resolved !== row.built);

        expect(disagreements).toEqual([]);
    });
});
