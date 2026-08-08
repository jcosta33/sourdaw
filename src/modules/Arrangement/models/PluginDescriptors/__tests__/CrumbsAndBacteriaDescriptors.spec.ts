import { describe, expect, it } from 'vitest';

import { BACTERIA_DESCRIPTOR } from '../BacteriaDescriptor';
import { CRUMBS_DESCRIPTOR } from '../CrumbsDescriptor';

describe('CRUMBS_DESCRIPTOR', () => {
    it('has a non-empty id', () => {
        expect(CRUMBS_DESCRIPTOR.id).toBeTruthy();
    });

    it('has a non-empty name and vendor', () => {
        expect(CRUMBS_DESCRIPTOR.name).toBeTruthy();
        expect(CRUMBS_DESCRIPTOR.vendor).toBeTruthy();
    });

    it('has at least one parameter', () => {
        expect(CRUMBS_DESCRIPTOR.parameters.length).toBeGreaterThan(0);
    });

    it('every parameter has an id, name, and valid type', () => {
        for (const param of CRUMBS_DESCRIPTOR.parameters) {
            expect(param.id).toBeTruthy();
            expect(param.name).toBeTruthy();
            expect(['float', 'int', 'bool', 'choice']).toContain(param.type);
        }
    });

    it('float parameters have min <= max', () => {
        for (const param of CRUMBS_DESCRIPTOR.parameters) {
            if (param.type === 'float') {
                const min = (param as { minValue: number }).minValue;
                const max = (param as { maxValue: number }).maxValue;
                expect(min).toBeLessThanOrEqual(max);
            }
        }
    });
});

describe('BACTERIA_DESCRIPTOR', () => {
    it('has a non-empty id', () => {
        expect(BACTERIA_DESCRIPTOR.id).toBeTruthy();
    });

    it('has a non-empty name and vendor', () => {
        expect(BACTERIA_DESCRIPTOR.name).toBeTruthy();
        expect(BACTERIA_DESCRIPTOR.vendor).toBeTruthy();
    });

    it('has at least one parameter', () => {
        expect(BACTERIA_DESCRIPTOR.parameters.length).toBeGreaterThan(0);
    });

    it('every parameter has an id, name, and valid type', () => {
        for (const param of BACTERIA_DESCRIPTOR.parameters) {
            expect(param.id).toBeTruthy();
            expect(param.name).toBeTruthy();
            expect(['float', 'int', 'bool', 'choice']).toContain(param.type);
        }
    });

    it('float parameters have min <= max', () => {
        for (const param of BACTERIA_DESCRIPTOR.parameters) {
            if (param.type === 'float') {
                const min = (param as { minValue: number }).minValue;
                const max = (param as { maxValue: number }).maxValue;
                expect(min).toBeLessThanOrEqual(max);
            }
        }
    });
});
