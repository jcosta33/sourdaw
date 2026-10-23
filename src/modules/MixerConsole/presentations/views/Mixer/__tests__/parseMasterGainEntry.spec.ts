import { describe, expect, it } from 'vitest';

import { dbToGain, FADER_HEADROOM_DB } from '#/utils/audioLevelLaw';

import { parseMasterGainEntry } from '../parseMasterGainEntry';

describe('parseMasterGainEntry', () => {
    it.each([
        { input: '0', gain: 1 },
        { input: '  -6 dB  ', gain: dbToGain(-6) },
        { input: '+6DB', gain: dbToGain(FADER_HEADROOM_DB) },
        { input: '.5 db', gain: dbToGain(0.5) },
        { input: '6.', gain: dbToGain(6) },
        { input: '-120', gain: dbToGain(-120) },
        { input: '-inf', gain: 0 },
        { input: '-infinity', gain: 0 },
        { input: '-∞', gain: 0 },
    ])('converts $input through the shared gain law', ({ input, gain }) => {
        expect(parseMasterGainEntry(input)).toBe(gain);
    });

    it.each(['', '  ', '+7', '6.0001 dB', 'NaN', '+Infinity', '1e1', '1 dB extra', '- 6', '0x10', '1,5'])(
        'rejects invalid or out-of-range input %s',
        (input) => {
            expect(parseMasterGainEntry(input)).toBeNull();
        }
    );

    it('rejects a decimal that cannot be represented as a finite number', () => {
        expect(parseMasterGainEntry('9'.repeat(400))).toBeNull();
    });
});
