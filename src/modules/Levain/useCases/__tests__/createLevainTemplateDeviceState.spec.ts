import { describe, expect, it } from 'vitest';

import { fromLevainDeviceState } from '../../models/LevainDeviceState';
import { createLevainTemplateDeviceState } from '../createLevainTemplateDeviceState';

describe('createLevainTemplateDeviceState', () => {
    it.each(['violin-1', 'violin-2', 'viola', 'cello', 'double-bass'] as const)(
        'persists the %s bank with its default sustain articulation',
        (instrumentId) => {
            const state = createLevainTemplateDeviceState(instrumentId);

            expect(structuredClone(state)).toEqual({
                version: 1,
                data: { instrumentId, currentArticulation: 'sustain' },
            });
            expect(fromLevainDeviceState(state)).toEqual({ instrumentId, currentArticulation: 'sustain' });
        }
    );
});
