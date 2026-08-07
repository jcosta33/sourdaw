import { describe, expect, it } from 'vitest';

import { BUILTIN_EFFECT_DESCRIPTORS } from '../BuiltinEffectDescriptors';

describe('BuiltinEffectDescriptors', () => {
    it('exports 19 effect descriptors', () => {
        expect(BUILTIN_EFFECT_DESCRIPTORS).toHaveLength(19);
    });

    it('every descriptor has a unique id starting with builtin-', () => {
        const ids = new Set<string>();
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            expect(desc.id).toMatch(/^builtin-/);
            expect(ids.has(desc.id)).toBe(false);
            ids.add(desc.id);
        }
    });

    it('every descriptor has a non-empty name and vendor', () => {
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            expect(desc.name).toBeTruthy();
            expect(desc.vendor).toBeTruthy();
        }
    });

    it('every descriptor has a valid category', () => {
        const validCategories = new Set(['effect', 'analyzer', 'utility']);
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            expect(validCategories.has(desc.category)).toBe(true);
        }
    });

    it('every descriptor has at least one parameter', () => {
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            expect(desc.parameters.length).toBeGreaterThan(0);
        }
    });

    it('every parameter has an id, name, and type', () => {
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            for (const param of desc.parameters) {
                expect(param.id).toBeTruthy();
                expect(param.name).toBeTruthy();
                expect(['float', 'int', 'bool', 'choice']).toContain(param.type);
            }
        }
    });

    it('float parameters have min/max/default values', () => {
        for (const desc of BUILTIN_EFFECT_DESCRIPTORS) {
            for (const param of desc.parameters) {
                if (param.type === 'float') {
                    expect(param.minValue).toBeDefined();
                    expect(param.maxValue).toBeDefined();
                    expect(param.defaultValue).toBeDefined();
                    expect((param as { minValue: number }).minValue).toBeLessThanOrEqual(
                        (param as { maxValue: number }).maxValue
                    );
                }
            }
        }
    });

    it('includes well-known effect ids', () => {
        const ids = BUILTIN_EFFECT_DESCRIPTORS.map((d) => d.id);
        expect(ids).toContain('builtin-eq');
        expect(ids).toContain('builtin-compressor');
        expect(ids).toContain('builtin-reverb');
        expect(ids).toContain('builtin-delay');
    });
});
