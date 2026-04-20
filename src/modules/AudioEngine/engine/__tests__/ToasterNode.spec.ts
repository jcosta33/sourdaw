import { describe, it, expect } from 'vitest';

import { isToasterDevice } from '../ToasterNode';

describe('isToasterDevice', () => {
    it('should return true only for the toaster device type string', () => {
        expect(isToasterDevice('toaster')).toBe(true);
        expect(isToasterDevice('fermenter')).toBe(false);
    });
});
