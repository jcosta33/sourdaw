import { describe, it, expect } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import {
    A4_REFERENCE_PARAM_ID,
    DEFAULT_A4_REFERENCE_HZ,
    MAX_A4_REFERENCE_HZ,
    MIN_A4_REFERENCE_HZ,
} from '../A4Reference';

/**
 * Weld: the Tuner's four reference constants against the `native-scoring`
 * descriptor read out of the plugin registry.
 *
 * Two independently-sourced values, not a value compared to itself. The
 * descriptor is what the write doors enforce — `clampDeviceParameterValue`
 * pins every `a4_hz` write to its declared range, and the engine's `set_param`
 * matches its id exactly with a `_ => {}` arm behind it. So the knob sweeping a
 * span the descriptor does not declare offers readings the write silently
 * changes, and a drifted id reaches the DSP and is dropped without a trace.
 */
describe('A4 reference constants', () => {
    const scoring = getPluginById('native-scoring');
    const parameter = scoring?.parameters.find((candidate) => candidate.id === A4_REFERENCE_PARAM_ID);

    it('names a parameter the native-scoring descriptor actually declares', () => {
        // Presence pin for the three range assertions below: if the id drifts,
        // `parameter` is undefined and every `parameter?.x` comparison would
        // otherwise be vacuously... not equal — but the failure would read as a
        // range mismatch rather than a missing parameter. Name it here.
        expect(scoring?.parameters.map((candidate) => candidate.id)).toContain('a4_hz');
    });

    it('matches the descriptor default, minimum and maximum', () => {
        expect(parameter?.defaultValue).toBe(DEFAULT_A4_REFERENCE_HZ);
        expect(parameter?.minValue).toBe(MIN_A4_REFERENCE_HZ);
        expect(parameter?.maxValue).toBe(MAX_A4_REFERENCE_HZ);
    });

    it('declares a continuous parameter, so the knob may land any integer in range', () => {
        // `quantiseDeviceParameterValue` rounds stepped types at delivery; a
        // float type is what lets the panel round to whole Hz itself and have
        // the delivered value survive unchanged.
        expect(parameter?.type).toBe('float');
        expect(parameter?.unit).toBe('Hz');
    });
});
