import { describe, expect, it } from 'vitest';

import { type Device } from '../../../models/Track';
import { freezeCompensationOmitTypes } from '../freezeCompensationOmitTypes';

function device(partial: Partial<Device> & Pick<Device, 'id' | 'type'>): Device {
    return {
        name: partial.name ?? partial.type,
        bypassed: partial.bypassed ?? false,
        parameterValues: partial.parameterValues ?? {},
        ...partial,
    };
}

describe('freezeCompensationOmitTypes', () => {
    it('returns withheld types unchanged when the track has no external-plugin', () => {
        expect(freezeCompensationOmitTypes([device({ id: 'eq', type: 'Knead' })], ['withheld-effect'])).toEqual([
            'withheld-effect',
        ]);
    });

    it('adds a non-bypassed external-plugin when withheld is empty', () => {
        expect(freezeCompensationOmitTypes([device({ id: 'plug', type: 'external-plugin' })], [])).toEqual([
            'external-plugin',
        ]);
    });

    it('does not add a bypassed external-plugin', () => {
        expect(
            freezeCompensationOmitTypes([device({ id: 'plug', type: 'external-plugin', bypassed: true })], [])
        ).toEqual([]);
    });

    it('unions withheld types with a non-bypassed external-plugin without duplicating', () => {
        expect(
            freezeCompensationOmitTypes(
                [device({ id: 'plug', type: 'external-plugin' })],
                ['withheld-effect', 'external-plugin']
            )
        ).toEqual(['withheld-effect', 'external-plugin']);
    });
});
