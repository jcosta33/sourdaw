import { describe, it, expect, beforeEach } from 'vitest';

import { type Store } from '#/infra/store/types';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import {
    type GrandBouleMidiCalibration,
    createDefaultMidiCalibration,
} from '../../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../../models/GrandBoulePreset';
import { type GrandBouleState } from '../../../stores/grandBouleStore';
import { setMidiCalibrationParam } from '../setMidiCalibrationParam';

type CalibrationExpectation = {
    key: keyof GrandBouleMidiCalibration;
    input: number;
    expected: number;
};

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

describe('setMidiCalibrationParam', () => {
    beforeEach(() => {
        resetGrandBouleStore();
    });

    it('should update only the selected calibration key', () => {
        const stateBefore = mockStore.value;
        expect(stateBefore).not.toBeNull();
        if (stateBefore === null) {
            throw new Error('Expected GrandBoule store to be initialized');
        }

        setMidiCalibrationParam(mockStore, 'sustainThreshold', 0.32);

        const stateAfter = mockStore.value;
        expect(stateAfter).not.toBeNull();
        if (stateAfter === null) {
            throw new Error('Expected GrandBoule store to stay initialized');
        }
        expect(stateAfter.midiCalibration).toEqual({
            ...stateBefore.midiCalibration,
            sustainThreshold: 0.32,
        });
    });

    it('should clamp each calibration key to its configured minimum', () => {
        const expectations: CalibrationExpectation[] = [
            { key: 'velocityCurveExponent', input: -1, expected: 0.5 },
            { key: 'velocityFloor', input: -1, expected: 0 },
            { key: 'velocityCeiling', input: 0, expected: 0.5 },
            { key: 'ccSmoothingMs', input: -1, expected: 0 },
            { key: 'sustainThreshold', input: -1, expected: 0 },
        ];

        for (const expectation of expectations) {
            resetGrandBouleStore();
            const stateBefore = mockStore.value;
            expect(stateBefore).not.toBeNull();
            if (stateBefore === null) {
                throw new Error('Expected GrandBoule store to be initialized');
            }

            setMidiCalibrationParam(mockStore, expectation.key, expectation.input);

            const stateAfter = mockStore.value;
            expect(stateAfter).not.toBeNull();
            if (stateAfter === null) {
                throw new Error('Expected GrandBoule store to stay initialized');
            }
            expect(stateAfter.midiCalibration).toEqual({
                ...stateBefore.midiCalibration,
                [expectation.key]: expectation.expected,
            });
        }
    });

    it('should clamp each calibration key to its configured maximum', () => {
        const expectations: CalibrationExpectation[] = [
            { key: 'velocityCurveExponent', input: 9, expected: 2 },
            { key: 'velocityFloor', input: 9, expected: 0.5 },
            { key: 'velocityCeiling', input: 9, expected: 1 },
            { key: 'ccSmoothingMs', input: 99, expected: 50 },
            { key: 'sustainThreshold', input: 9, expected: 0.5 },
        ];

        for (const expectation of expectations) {
            resetGrandBouleStore();
            const stateBefore = mockStore.value;
            expect(stateBefore).not.toBeNull();
            if (stateBefore === null) {
                throw new Error('Expected GrandBoule store to be initialized');
            }

            setMidiCalibrationParam(mockStore, expectation.key, expectation.input);

            const stateAfter = mockStore.value;
            expect(stateAfter).not.toBeNull();
            if (stateAfter === null) {
                throw new Error('Expected GrandBoule store to stay initialized');
            }
            expect(stateAfter.midiCalibration).toEqual({
                ...stateBefore.midiCalibration,
                [expectation.key]: expectation.expected,
            });
        }
    });

    it('should not mutate when grandBouleStore value is null', () => {
        mockStore.set(null);

        setMidiCalibrationParam(mockStore, 'velocityFloor', 0.2);

        expect(mockStore.value).toBeNull();
    });
});
