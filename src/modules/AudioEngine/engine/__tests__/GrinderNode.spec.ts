import { describe, it, expect } from 'vitest';

import { isGrinderDevice } from '../GrinderNode';

describe('isGrinderDevice', () => {
    it('should return true only for the grinder device type string', () => {
        expect(isGrinderDevice('grinder')).toBe(true);
        expect(isGrinderDevice('proof')).toBe(false);
    });
});
