import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../../models/GrandBoulePreset';
import { grandBouleStore } from '../../../stores/grandBouleStore';
import { clamp, updateCalibration } from '../helpers';

function resetGrandBouleStore(): void {
    grandBouleStore.set({
        config: createDefaultGrandBouleConfig(),
        parameters: createNeutralPresetParameters(),
        pedals: { sustain: 0, unaCorda: false, sostenuto: false },
        midiCalibration: createDefaultMidiCalibration(),
        perNoteOverrides: new Map(),
        morph: createDefaultMorphState(),
        temperament: 0,
        engineReady: false,
        activeVoices: 0,
    });
}

describe('calibrateGrandBouleMidi helpers', () => {
    describe('clamp', () => {
        it('should clamp values below the minimum', () => {
            expect(clamp(-2, 0, 10)).toBe(0);
        });

        it('should clamp values above the maximum', () => {
            expect(clamp(99, 0, 10)).toBe(10);
        });

        it('should leave values inside the range unchanged', () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });
    });

    describe('updateCalibration', () => {
        beforeEach(() => {
            resetGrandBouleStore();
        });

        it('should merge partial calibration into the store', () => {
            updateCalibration({ velocityFloor: 0.12 });
            expect(grandBouleStore.value?.midiCalibration.velocityFloor).toBe(0.12);
            expect(grandBouleStore.value?.midiCalibration.velocityCeiling).toBe(1);
        });

        it('should not mutate when grandBouleStore value is null', () => {
            grandBouleStore.set(null);
            updateCalibration({ velocityFloor: 0.2 });
            expect(grandBouleStore.value).toBeNull();
        });
    });
});
