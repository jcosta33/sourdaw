import { describe, it, expect } from 'vitest';

import * as subject from '../handleMidiMessage';

const { scaleMidiValue } = subject;

describe('handleMidiMessage', () => {
    it('should export handleMidiMessage', () => {
        expect(subject.handleMidiMessage).toBeDefined();
        const time = typeof subject.handleMidiMessage;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export scaleMidiValue', () => {
        expect(subject.scaleMidiValue).toBeDefined();
        const time = typeof subject.scaleMidiValue;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

describe('scaleMidiValue', () => {
    it('maps the 7-bit range endpoints to [min, max] for every mode', () => {
        for (const mode of ['linear', 'log', 'exp'] as const) {
            expect(scaleMidiValue(0, 0, 1, mode)).toBeCloseTo(0);
            expect(scaleMidiValue(127, 0, 1, mode)).toBeCloseTo(1);
        }
    });

    it('defaults to a linear curve when no mode is given', () => {
        // Midpoint CC (~0.5 of range) lands at the linear midpoint.
        expect(scaleMidiValue(64, 0, 1)).toBeCloseTo(64 / 127);
        expect(scaleMidiValue(64, 0, 1, 'linear')).toBeCloseTo(64 / 127);
    });

    it('log mode is concave: midpoint sits above the linear midpoint', () => {
        const t = 64 / 127;
        // sqrt(t) > t for t in (0,1), so a log fader reaches higher faster.
        expect(scaleMidiValue(64, 0, 1, 'log')).toBeCloseTo(Math.sqrt(t));
        expect(scaleMidiValue(64, 0, 1, 'log')).toBeGreaterThan(scaleMidiValue(64, 0, 1, 'linear'));
    });

    it('exp mode is convex: midpoint sits below the linear midpoint', () => {
        const t = 64 / 127;
        // t*t < t for t in (0,1), so an exp fader stays low longer.
        expect(scaleMidiValue(64, 0, 1, 'exp')).toBeCloseTo(t * t);
        expect(scaleMidiValue(64, 0, 1, 'exp')).toBeLessThan(scaleMidiValue(64, 0, 1, 'linear'));
    });

    it('honours an asymmetric range such as pan [-50, 50]', () => {
        expect(scaleMidiValue(0, -50, 50, 'linear')).toBeCloseTo(-50);
        expect(scaleMidiValue(127, -50, 50, 'linear')).toBeCloseTo(50);
        expect(scaleMidiValue(64, -50, 50, 'linear')).toBeCloseTo(-50 + (64 / 127) * 100);
    });

    it('clamps out-of-spec raw values into the target range', () => {
        expect(scaleMidiValue(200, 0, 1, 'linear')).toBeCloseTo(1);
        expect(scaleMidiValue(-5, 0, 1, 'linear')).toBeCloseTo(0);
    });
});
