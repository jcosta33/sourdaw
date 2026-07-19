import { describe, it, expect } from 'vitest';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { applyVelocityCurve } from '../applyVelocityCurve';

describe('applyVelocityCurve', () => {
    describe('linear curve (default calibration)', () => {
        const calibration = createDefaultMidiCalibration();

        it('maps raw velocity 0 to 0', () => {
            expect(applyVelocityCurve(0, calibration)).toBe(0);
        });

        it('maps raw velocity 127 (max MIDI) to 1', () => {
            expect(applyVelocityCurve(127, calibration)).toBe(1);
        });

        it('maps a mid-range raw velocity proportionally', () => {
            // 63.5 / 127 = 0.5 exactly, exponent 1.0 leaves it unchanged.
            expect(applyVelocityCurve(63.5, calibration)).toBeCloseTo(0.5, 10);
        });
    });

    describe('curve exponent shaping', () => {
        it('compresses low velocities upward when exponent < 1', () => {
            const calibration = { ...createDefaultMidiCalibration(), velocityCurveExponent: 0.5 };
            // normalised = 0.25, curved = 0.25 ** 0.5 = 0.5
            expect(applyVelocityCurve(0.25 * 127, calibration)).toBeCloseTo(0.5, 10);
        });

        it('expands low velocities downward when exponent > 1', () => {
            const calibration = { ...createDefaultMidiCalibration(), velocityCurveExponent: 2 };
            // normalised = 0.5, curved = 0.5 ** 2 = 0.25
            expect(applyVelocityCurve(0.5 * 127, calibration)).toBeCloseTo(0.25, 10);
        });
    });

    describe('floor/ceiling scaling', () => {
        it('rescales the curved value into a narrowed floor-ceiling range', () => {
            const calibration = {
                ...createDefaultMidiCalibration(),
                velocityFloor: 0.2,
                velocityCeiling: 0.8,
            };
            // normalised = curved = 0.5 (exponent 1.0), result = 0.2 + 0.5 * (0.8 - 0.2) = 0.5
            expect(applyVelocityCurve(0.5 * 127, calibration)).toBeCloseTo(0.5, 10);
        });

        it('returns exactly the floor at raw velocity 0', () => {
            const calibration = { ...createDefaultMidiCalibration(), velocityFloor: 0.3, velocityCeiling: 0.9 };
            expect(applyVelocityCurve(0, calibration)).toBeCloseTo(0.3, 10);
        });

        it('returns exactly the ceiling at raw velocity 127', () => {
            const calibration = { ...createDefaultMidiCalibration(), velocityFloor: 0.3, velocityCeiling: 0.9 };
            expect(applyVelocityCurve(127, calibration)).toBeCloseTo(0.9, 10);
        });
    });

    describe('input clamping', () => {
        const calibration = createDefaultMidiCalibration();

        it('clamps a negative raw velocity to the floor', () => {
            expect(applyVelocityCurve(-20, calibration)).toBe(0);
        });

        it('clamps a raw velocity above 127 to the ceiling', () => {
            expect(applyVelocityCurve(400, calibration)).toBe(1);
        });
    });
});
