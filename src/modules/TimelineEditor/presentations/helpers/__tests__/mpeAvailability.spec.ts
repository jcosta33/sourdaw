import { describe, it, expect } from 'vitest';

import { addPitchBend, setNotePressure, setNoteSlide } from '#/modules/MIDI/useCases';

import { MPE_EXPRESSION_AVAILABLE, MPE_EXPRESSION_LANES, isMpeExpressionLane } from '../mpeAvailability';

describe('mpeAvailability', () => {
    it('gates MPE per-note expression off until the engine path lands (audit MD-2)', () => {
        // The honest surface hides the MPE lanes while the flag is false. Wave 4
        // flips this to true once per-note expression reaches instrument voices.
        expect(MPE_EXPRESSION_AVAILABLE).toBe(false);
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
