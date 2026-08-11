import { describe, expect, it } from 'vitest';

import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../GrinderPatch';
import { applyGrinderProjectParameters, GRINDER_PROJECT_PARAM_KEYS } from '../GrinderProjectParameterMap';

describe('Grinder project parameter projection', () => {
    it('covers every descriptor-backed control exactly once', () => {
        const descriptorKeys = getAutomationDeviceDescriptor('grinder')?.parameters.map((parameter) => parameter.id);

        expect([...GRINDER_PROJECT_PARAM_KEYS].sort()).toEqual(descriptorKeys?.sort());
    });

    it('decodes stored values, restores absent defaults, and preserves session-only fields', () => {
        const projected = applyGrinderProjectParameters(
            { ...DEFAULT_PATCH, uiSection: 'lab', gain: 9, bright: true, engineMode: 'hybrid' },
            { gain: 2, bright: 0, engineMode: 1 }
        );

        expect(projected).toMatchObject({
            uiSection: 'lab',
            gain: 2,
            bright: false,
            engineMode: 'capture',
            bass: DEFAULT_PATCH.bass,
        });
    });
});
