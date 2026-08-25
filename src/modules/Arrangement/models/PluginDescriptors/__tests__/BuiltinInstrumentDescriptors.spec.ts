import { describe, expect, it } from 'vitest';

import { BUILTIN_INSTRUMENT_DESCRIPTORS } from '../BuiltinInstrumentDescriptors';
import { GRAND_BOULE_DESCRIPTOR } from '../GrandBouleDescriptor';

describe('BuiltinInstrumentDescriptors', () => {
    it('exports instrument descriptors', () => {
        expect(BUILTIN_INSTRUMENT_DESCRIPTORS.length).toBeGreaterThan(0);
    });

    it('every descriptor has a unique id', () => {
        const ids = new Set<string>();
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            expect(desc.id).toBeTruthy();
            expect(ids.has(desc.id)).toBe(false);
            ids.add(desc.id);
        }
    });

    it('every descriptor has a non-empty name and vendor', () => {
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            expect(desc.name).toBeTruthy();
            expect(desc.vendor).toBeTruthy();
        }
    });

    it('every descriptor is category instrument', () => {
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            expect(desc.category).toBe('instrument');
        }
    });

    it('every descriptor has at least one parameter', () => {
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            expect(desc.parameters.length).toBeGreaterThan(0);
        }
    });

    it('every parameter has an id, name, and valid type', () => {
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            for (const param of desc.parameters) {
                expect(param.id).toBeTruthy();
                expect(param.name).toBeTruthy();
                expect(['float', 'int', 'bool', 'choice']).toContain(param.type);
            }
        }
    });

    it('float parameters have min <= max', () => {
        for (const desc of BUILTIN_INSTRUMENT_DESCRIPTORS) {
            for (const param of desc.parameters) {
                if (param.type === 'float') {
                    const min = (param as { minValue: number }).minValue;
                    const max = (param as { maxValue: number }).maxValue;
                    expect(min).toBeLessThanOrEqual(max);
                }
            }
        }
    });

    it('includes builtin-synth descriptor', () => {
        const ids = BUILTIN_INSTRUMENT_DESCRIPTORS.map((d) => d.id);
        expect(ids).toContain('builtin-synth');
    });

    it('advertises Grand Boule radiation controls once offline scheduling is available', () => {
        const radiationParameters = GRAND_BOULE_DESCRIPTOR.parameters.filter((parameter) =>
            ['lidPosition', 'micPosition'].includes(parameter.id)
        );

        expect(radiationParameters).toHaveLength(2);
        expect(radiationParameters.map((parameter) => parameter.automatable)).toEqual([true, true]);
    });

    it('keeps Grand Boule master travel inside the native safety clamp', () => {
        const master = GRAND_BOULE_DESCRIPTOR.parameters.find((parameter) => parameter.id === 'masterGain');

        expect(master).toMatchObject({ minValue: 0, maxValue: 1, defaultValue: 0.1 });
    });
});
