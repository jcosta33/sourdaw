import { describe, expect, it } from 'vitest';

import { FERMENTER_DESCRIPTOR } from '../FermenterDescriptor';

describe('FERMENTER_DESCRIPTOR', () => {
    function by_id(id: string) {
        return FERMENTER_DESCRIPTOR.parameters.find((param) => param.id === id);
    }

    it('should expose the Fermenter built-in instrument descriptor', () => {
        expect(FERMENTER_DESCRIPTOR).toMatchObject({
            id: 'fermenter',
            name: 'Fermenter',
            vendor: 'Sourdaw',
            format: 'builtin',
            category: 'instrument',
            hasCustomUI: true,
        });
        expect(FERMENTER_DESCRIPTOR.parameters).toHaveLength(105);
    });

    it.each([
        ['oscEngine', 'int', 0, 6, 0, '', undefined],
        ['filterCutoff', 'float', 20, 20000, 5000, 'Hz', 'log'],
        ['ampAttack', 'float', 0.001, 5, 0.01, 's', 'log'],
        ['activeLayer', 'int', 0, 3, 0, '', undefined],
        ['masterGain', 'float', 0, 2, 1, '', undefined],
    ] as const)(
        'should preserve the host-visible %s parameter mapping',
        (id, type, min_value, max_value, default_value, unit, scaling) => {
            const param = by_id(id);

            expect(param?.id).toBe(id);
            expect(param?.deviceId).toBe('fermenter');
            expect(typeof param?.name).toBe('string');
            expect(param?.name.length).toBeGreaterThan(0);
            expect(param?.type).toBe(type);
            expect(param?.value).toBe(default_value);
            expect(param?.defaultValue).toBe(default_value);
            expect(param?.minValue).toBe(min_value);
            expect(param?.maxValue).toBe(max_value);
            expect(param?.unit).toBe(unit);
            expect(param?.scaling).toBe(scaling);
            expect(param?.automatable).toBe(true);
            expect(param?.hasAutomation).toBe(false);
        }
    );
});
