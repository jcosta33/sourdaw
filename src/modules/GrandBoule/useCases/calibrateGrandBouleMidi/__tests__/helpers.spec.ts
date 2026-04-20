import { type GrandBouleState } from '../../stores/grandBouleStore';
import { type Store } from '#/infra/store/types';
import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../../models/GrandBoulePreset';
import { clamp, updateCalibration } from '../helpers';

// Mock store to satisfy the interface
const mockStore = {
    value: null as GrandBouleState | null,
    set(val: GrandBouleState | null) {
        this.value = val;
    },
} as unknown as Store<GrandBouleState>;

function resetGrandBouleStore(): void {
    mockStore.set({
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
            updateCalibration(mockStore, { velocityFloor: 0.12 });
            expect(mockStore.value?.midiCalibration.velocityFloor).toBe(0.12);
            expect(mockStore.value?.midiCalibration.velocityCeiling).toBe(1);
        });

        it('should not mutate when grandBouleStore value is null', () => {
            mockStore.set(null);
            updateCalibration(mockStore, { velocityFloor: 0.2 });
            expect(mockStore.value).toBeNull();
        });
    });
});
