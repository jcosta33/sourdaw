import { describe, it, expect } from 'vitest';

import { DEFAULT_PARAMS } from '../../../models/ProofChamberState';
import { exportPresetJson } from '../exportPresetJson';

describe('exportPresetJson', () => {
    it('should stringify params with indentation', () => {
        const json = exportPresetJson(DEFAULT_PARAMS);
        expect(json).toContain('\n');
        expect(JSON.parse(json)).toEqual(DEFAULT_PARAMS);
    });
});
