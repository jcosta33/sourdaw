import { describe, it, expect } from 'vitest';

import { getNoteExpressionDimensions } from '#/modules/AudioEngine/useCases';
import { addPitchBend, setNotePressure, setNoteSlide } from '#/modules/MIDI/useCases';

import {
    MPE_EXPRESSION_LANES,
    getMpeExpressionLanesForDeviceTypes,
    isMpeExpressionLane,
    isMpeLaneAvailableForDeviceTypes,
} from '../mpeAvailability';

describe('mpeAvailability', () => {
    it('derives lane availability from the engine registry rather than a hand-kept list (audit MD-2)', () => {
        // One source of truth: the editor cannot drift from what the engines
        // actually sound, per dimension.
        for (const deviceType of ['fermenter', 'levain', 'grand-boule', 'toaster']) {
            expect([...getMpeExpressionLanesForDeviceTypes([deviceType])].sort()).toEqual(
                [...getNoteExpressionDimensions(deviceType)].sort()
            );
        }
    });

    it('offers every dimension for an instrument that sounds all three', () => {
        expect(getMpeExpressionLanesForDeviceTypes(['fermenter', 'builtin-eq'])).toEqual([
            'pressure',
            'slide',
            'pitchBend',
        ]);
        expect(getMpeExpressionLanesForDeviceTypes(['levain'])).toEqual(['pressure', 'slide', 'pitchBend']);
    });

    it('offers Grand Boule pitch bend only — its engine sounds no pressure or timbre', () => {
        expect(getMpeExpressionLanesForDeviceTypes(['grand-boule'])).toEqual(['pitchBend']);
        expect(isMpeLaneAvailableForDeviceTypes('pitchBend', ['grand-boule'])).toBe(true);
        expect(isMpeLaneAvailableForDeviceTypes('pressure', ['grand-boule'])).toBe(false);
        expect(isMpeLaneAvailableForDeviceTypes('slide', ['grand-boule'])).toBe(false);
    });

    it('offers no MPE lane for a track with no expression-capable instrument', () => {
        expect(getMpeExpressionLanesForDeviceTypes(['toaster'])).toEqual([]);
        expect(getMpeExpressionLanesForDeviceTypes([])).toEqual([]);
    });

    it('never gates the non-MPE lanes on the instrument', () => {
        expect(isMpeLaneAvailableForDeviceTypes('velocity', [])).toBe(true);
        expect(isMpeLaneAvailableForDeviceTypes('cc1', ['toaster'])).toBe(true);
    });

    it('classifies exactly the three MPE per-note expression dimensions', () => {
        expect([...MPE_EXPRESSION_LANES]).toEqual(['pressure', 'slide', 'pitchBend']);
        expect(isMpeExpressionLane('pressure')).toBe(true);
        expect(isMpeExpressionLane('slide')).toBe(true);
        expect(isMpeExpressionLane('pitchBend')).toBe(true);
    });

    it('does not gate velocity, probability, or CC lanes', () => {
        expect(isMpeExpressionLane('velocity')).toBe(false);
        expect(isMpeExpressionLane('probability')).toBe(false);
        expect(isMpeExpressionLane('cc1')).toBe(false);
    });

    it('leaves the underlying MPE state-write use cases intact (state model survives)', () => {
        // Hiding the surface must not delete the state model or its writers: the
        // Wave-4 engine fix consumes MPE data that may already exist in projects.
        expect(typeof setNotePressure).toBe('function');
        expect(typeof setNoteSlide).toBe('function');
        expect(typeof addPitchBend).toBe('function');
    });
});
