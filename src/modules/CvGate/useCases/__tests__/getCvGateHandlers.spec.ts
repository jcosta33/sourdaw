import { describe, expect, it } from 'vitest';

import { handleAddCvOutput } from '../../handlers/cvOutput/handleAddCvOutput';
import { handleRemoveCvOutput } from '../../handlers/cvOutput/handleRemoveCvOutput';
import { getCvGateHandlers } from '../getCvGateHandlers';

describe('getCvGateHandlers', () => {
    it('registers adding a CV/gate output and its inverse as CvGate’s own commands', () => {
        const handlers = getCvGateHandlers();

        expect(Object.keys(handlers)).toEqual(['addCvOutput', 'removeCvOutput']);
        expect(handlers.addCvOutput).toBe(handleAddCvOutput);
        expect(handlers.removeCvOutput).toBe(handleRemoveCvOutput);
        expect(handlers.addCvOutput.undoable).toBe(true);
        expect(handlers.removeCvOutput.undoable).toBe(false);
    });
});
