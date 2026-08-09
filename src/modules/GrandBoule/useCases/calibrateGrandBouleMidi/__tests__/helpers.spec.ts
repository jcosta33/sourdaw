import { describe, it, expect, beforeEach } from 'vitest';

import { type Store } from '#/infra/store/types';
import { clamp } from '#/utils/Math/clamp';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../../models/GrandBoulePreset';
import { type GrandBouleState } from '../../../stores/grandBouleStore';
import { updateCalibration } from '../helpers';

function createMockGrandBouleStore(): Store<GrandBouleState> {
    let value: GrandBouleState | null = null;

    return {
        get value() {
            return value;
        },
        set(nextValue: GrandBouleState | null) {
            value = nextValue;
        },
        trySet(nextValue: GrandBouleState | null) {
            value = nextValue;
            // An in-memory fake has no backing store that can refuse a write.
            return true;
        },
        update(updater: (current: GrandBouleState | null) => GrandBouleState | null) {
            value = updater(value);
        },
        clear() {
            value = null;
        },
        hydrate() {},
        subscribe() {
            return () => {};
        },
        subscribeReact() {
            return () => {};
        },
        getSnapshot() {
            return value;
        },
    };
}

const mockStore = createMockGrandBouleStore();

function resetGrandBouleStore(): void {
    mockStore.set({
        config: createDefaultGrandBouleConfig(),
        parameters: createNeutralPresetParameters(),
        pedals: { sustain: 0, unaCorda: false, sostenuto: false },
        midiCalibration: createDefaultMidiCalibration(),
        perNoteOverrides: new Map(),
        morph: createDefaultMorphState(),
        temperament: 0,
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
