import { describe, expect, it } from 'vitest';

import { normalizeDeviceParameterValueUnit } from '../deviceParameterValueUnit';

describe('normalizeDeviceParameterValueUnit', () => {
    it.each([
        ['dB', 'dB'],
        ['decibel', 'dB'],
        ['DECIBELS', 'dB'],
        ['Hz', 'Hz'],
        ['HERTZ', 'Hz'],
        ['ms', 'ms'],
        ['millisecond', 'ms'],
        ['MILLISECONDS', 'ms'],
        ['%', '%'],
        ['percent', '%'],
        ['PERCENTS', '%'],
        [':1', ':1'],
        ['st', 'semitones'],
        ['semitone', 'semitones'],
        ['SEMITONES', 'semitones'],
    ] as const)('normalizes %s to %s', (input, expected) => {
        expect(normalizeDeviceParameterValueUnit(input)).toBe(expected);
    });

    it.each(['milliseconds later', 's', 'sec', 'second', 'seconds', 'kHz', 'kilohertz', 'percentage', 'ratio'])(
        'does not normalize unsupported or partial unit %s',
        (input) => {
            expect(normalizeDeviceParameterValueUnit(input)).toBeNull();
        }
    );
});
