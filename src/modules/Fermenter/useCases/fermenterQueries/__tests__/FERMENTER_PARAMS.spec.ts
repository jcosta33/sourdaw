import { describe, it, expect } from 'vitest';

import { ENGINE_NAMES } from '../../../models/FermenterPatch';
import { FERMENTER_PARAMS } from '../FERMENTER_PARAMS';

describe('FERMENTER_PARAMS', () => {
    it('should load the module', () => {
        expect(FERMENTER_PARAMS.length).toBeGreaterThan(0);
    });

    it('should expose every oscillator engine in the generic param metadata', () => {
        const engineParam = FERMENTER_PARAMS.find((param) => param.id === 'oscEngine');

        expect(engineParam).toEqual(
            expect.objectContaining({
                min: 0,
                max: ENGINE_NAMES.length - 1,
                step: 1,
            })
        );
    });
});
