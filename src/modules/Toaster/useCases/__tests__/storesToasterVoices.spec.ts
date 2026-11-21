import { describe, expect, it } from 'vitest';

import { storesToasterVoices } from '../storesToasterVoices';

describe('storesToasterVoices', () => {
    it.each([
        ['toaster', true],
        ['builtin-drum-kit', false],
        ['drum-kit', false],
        ['fermenter', false],
        ['faust-reverb', false],
        ['', false],
    ])('answers %j with %s', (deviceType, expected) => {
        expect(storesToasterVoices(deviceType)).toBe(expected);
    });
});
