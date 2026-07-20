import { describe, it, expect } from 'vitest';

import { handleLoadRaveModel } from '../../handlers/rave/handleLoadRaveModel';
import { handleSetRaveBlend } from '../../handlers/rave/handleSetRaveBlend';
import { getRaveHandlers } from '../getRaveHandlers';

describe('getRaveHandlers', () => {
    it('maps action names to their concrete handler implementations', () => {
        const handlers = getRaveHandlers();

        expect(handlers.loadRaveModel).toBe(handleLoadRaveModel);
        expect(handlers.setRaveBlend).toBe(handleSetRaveBlend);
    });

    it('exposes exactly the RAVE action handlers', () => {
        const handlers = getRaveHandlers();

        expect(Object.keys(handlers).sort()).toEqual(['loadRaveModel', 'setRaveBlend']);
    });
});
