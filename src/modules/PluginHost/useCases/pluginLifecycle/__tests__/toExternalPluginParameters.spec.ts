import { describe, expect, it } from 'vitest';

import { type PluginParameter } from '../../../repositories/pluginBridge/types';
import { toExternalPluginParameters } from '../toExternalPluginParameters';

const wireParameter = (overrides: Partial<PluginParameter>): PluginParameter => ({
    id: 1,
    name: 'Param',
    value: 0.5,
    default_value: 0,
    min_value: 0,
    max_value: 1,
    unit: null,
    is_automatable: true,
    display_text: null,
    step_count: 0,
    is_list: false,
    is_read_only: false,
    ...overrides,
});

describe('toExternalPluginParameters', () => {
    it('maps the live display text, step count and flags onto the camelCase contract', () => {
        const [parameter] = toExternalPluginParameters([
            wireParameter({
                id: 4,
                display_text: '1.20 kHz',
                step_count: 3,
                is_list: true,
                is_read_only: true,
                is_automatable: false,
            }),
        ]);

        expect(parameter).toMatchObject({
            id: 4,
            displayText: '1.20 kHz',
            stepCount: 3,
            isList: true,
            isReadOnly: true,
            isAutomatable: false,
        });
    });

    it('keeps an absent display text as null and an absent unit as the empty string', () => {
        const [parameter] = toExternalPluginParameters([wireParameter({})]);

        expect(parameter?.displayText).toBeNull();
        expect(parameter?.unit).toBe('');
    });
});
