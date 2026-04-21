import { describe, it, expect } from 'vitest';

import * as subject from '../toggleVirginTerritory';

describe('toggleVirginTerritory', () => {
    it('should export toggleVirginTerritory', () => {
        expect(subject.toggleVirginTerritory).toBeDefined();
        const time = typeof subject.toggleVirginTerritory;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
