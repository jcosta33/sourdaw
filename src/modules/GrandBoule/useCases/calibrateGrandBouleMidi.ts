/**
 * Update MIDI calibration parameters for the Grand Boule piano (spec SS3.1).
 *
 * Each function clamps the incoming value to its valid range and writes the
 * updated calibration slice to the store.
 */

import {
    type GrandBouleMidiCalibration,
    createDefaultMidiCalibration,
    MIDI_CALIBRATION_RANGES,
} from '../models/GrandBouleMidiCalibration';
import { grandBouleStore } from '../stores/grandBouleStore';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const updateCalibration = (patch: Partial<GrandBouleMidiCalibration>): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        midiCalibration: { ...state.midiCalibration, ...patch },
    });
};

// --- Individual parameter setters -------------------------------------------

export const setVelocityCurveExponent = (exponent: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityCurveExponent;
    updateCalibration({ velocityCurveExponent: clamp(exponent, r.min, r.max) });
};

export const setVelocityFloor = (floor: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityFloor;
    updateCalibration({ velocityFloor: clamp(floor, r.min, r.max) });
};

export const setVelocityCeiling = (ceiling: number): void => {
    const r = MIDI_CALIBRATION_RANGES.velocityCeiling;
    updateCalibration({ velocityCeiling: clamp(ceiling, r.min, r.max) });
};

export const setCcSmoothingMs = (ms: number): void => {
    const r = MIDI_CALIBRATION_RANGES.ccSmoothingMs;
    updateCalibration({ ccSmoothingMs: clamp(ms, r.min, r.max) });
};

export const setSustainThreshold = (threshold: number): void => {
    const r = MIDI_CALIBRATION_RANGES.sustainThreshold;
    updateCalibration({ sustainThreshold: clamp(threshold, r.min, r.max) });
};

export const setAfterTouchSensitivity = (sensitivity: number): void => {
    const r = MIDI_CALIBRATION_RANGES.afterTouchSensitivity;
    updateCalibration({ afterTouchSensitivity: clamp(sensitivity, r.min, r.max) });
};

// --- Bulk operations --------------------------------------------------------

export const resetMidiCalibration = (): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        midiCalibration: createDefaultMidiCalibration(),
    });
};

/**
 * Apply a velocity through the current calibration curve.
 *
 * Useful for previewing how a raw MIDI velocity maps to the engine's
 * hammer force given the current floor/ceiling/exponent settings.
 */
export const applyVelocityCurve = (rawVelocity: number, calibration: GrandBouleMidiCalibration): number => {
    const normalised = clamp(rawVelocity / 127, 0, 1);
    const curved = Math.pow(normalised, calibration.velocityCurveExponent);
    const { velocityFloor, velocityCeiling } = calibration;
    return velocityFloor + curved * (velocityCeiling - velocityFloor);
};
