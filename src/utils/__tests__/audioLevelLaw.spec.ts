import { describe, it, expect } from 'vitest';

import { SEND_MIN_DB, dbToGain, gainToDb, levelToSendPosition, sendPositionToLevel } from '../audioLevelLaw';

describe('dbToGain', () => {
    it('maps 0 dB to unity gain', () => {
        expect(dbToGain(0)).toBe(1);
    });

    it('maps -6.0206 dB to half amplitude', () => {
        expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 5);
    });

    it('maps -20 dB to a tenth of amplitude', () => {
        expect(dbToGain(-20)).toBeCloseTo(0.1, 10);
    });

    it('maps +6.0206 dB to double amplitude', () => {
        expect(dbToGain(6.0206)).toBeCloseTo(2, 4);
    });
});

describe('gainToDb', () => {
    it('maps unity gain to 0 dB', () => {
        expect(gainToDb(1)).toBe(0);
    });

    it('maps half amplitude to about -6.02 dB', () => {
        expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 4);
    });

    it('reports negative infinity for silence rather than NaN', () => {
        expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
        expect(gainToDb(-1)).toBe(Number.NEGATIVE_INFINITY);
    });
});

describe('sendPositionToLevel', () => {
    it('puts unity gain at the top of the control travel', () => {
        expect(sendPositionToLevel(100)).toBe(1);
    });

    it('closes the send completely at the bottom of the travel', () => {
        // A hard zero, not dbToGain(-60): removeSend semantics key off level > 0.
        expect(sendPositionToLevel(0)).toBe(0);
    });

    it('spends the travel evenly in decibels rather than in amplitude', () => {
        // The defect FX-7 names: a linear law put position 50 at 0.5 (-6 dB),
        // burning half the travel on the top 6 dB. Midway is now -30 dB.
        expect(gainToDb(sendPositionToLevel(50))).toBeCloseTo(-30, 6);
        expect(sendPositionToLevel(50)).toBeCloseTo(0.0316227766, 8);
        expect(gainToDb(sendPositionToLevel(25))).toBeCloseTo(-45, 6);
        expect(gainToDb(sendPositionToLevel(75))).toBeCloseTo(-15, 6);
    });

    it('clamps positions outside the control range', () => {
        expect(sendPositionToLevel(140)).toBe(1);
        expect(sendPositionToLevel(-20)).toBe(0);
    });

    it('is monotonically increasing across the travel', () => {
        let previous = -1;
        for (let position = 0; position <= 100; position++) {
            const level = sendPositionToLevel(position);
            expect(level).toBeGreaterThan(previous);
            previous = level;
        }
    });
});

describe('levelToSendPosition', () => {
    it('round-trips every control position back to itself', () => {
        for (let position = 1; position <= 100; position++) {
            expect(levelToSendPosition(sendPositionToLevel(position))).toBeCloseTo(position, 10);
        }
    });

    it('displays silence at the bottom of the travel', () => {
        expect(levelToSendPosition(0)).toBe(0);
    });

    it('displays unity at the top of the travel', () => {
        expect(levelToSendPosition(1)).toBe(100);
    });

    it('pins an imported over-unity level at the top instead of overshooting', () => {
        expect(levelToSendPosition(4)).toBe(100);
    });

    it('pins a level below the floor at the bottom instead of going negative', () => {
        // -80 dB is past SEND_MIN_DB, so it has no position on the control.
        expect(levelToSendPosition(dbToGain(SEND_MIN_DB - 20))).toBe(0);
    });
});
