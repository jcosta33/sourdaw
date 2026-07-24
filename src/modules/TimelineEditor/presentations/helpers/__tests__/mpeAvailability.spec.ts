import { describe, it, expect } from 'vitest';

import { getNoteExpressionDeviceTypes } from '#/modules/AudioEngine/useCases';
import { addPitchBend, setNotePressure, setNoteSlide } from '#/modules/MIDI/useCases';

import {
    MPE_EXPRESSION_AVAILABLE,
    MPE_EXPRESSION_DEVICE_TYPES,
    MPE_EXPRESSION_LANES,
    isMpeExpressionAvailableForDeviceTypes,
    isMpeExpressionLane,
} from '../mpeAvailability';

describe('mpeAvailability', () => {
    it('derives availability from the engine registry rather than a hand-kept list (audit MD-2)', () => {
        // One source of truth: the editor cannot drift from what the engines
        // actually sound.
        expect([...MPE_EXPRESSION_DEVICE_TYPES]).toEqual([...getNoteExpressionDeviceTypes()]);
        expect(MPE_EXPRESSION_AVAILABLE).toBe(getNoteExpressionDeviceTypes().length > 0);
    });

    it('offers the MPE lanes only for tracks whose instrument sounds per-note expression', () => {
        const [expressive] = getNoteExpressionDeviceTypes();

        expect(isMpeExpressionAvailableForDeviceTypes([expressive!, 'builtin-eq'])).toBe(true);
        expect(isMpeExpressionAvailableForDeviceTypes(['grand-boule', 'toaster'])).toBe(false);
        expect(isMpeExpressionAvailableForDeviceTypes([])).toBe(false);
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
