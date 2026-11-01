import { describe, it, expect } from 'vitest';

import { generateImpactsPack } from '../generateImpactsPack';
import { generateRisersPack } from '../generateRisersPack';
import { generateElectronicPerc } from '../percElectronic';
import { generateWorldPerc } from '../percWorld';

describe('factory synthesis additional packs', () => {
    it('world percussion generates samples', () => {
        const samples = generateWorldPerc();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.id).toBeTruthy();
            expect(s.category).toBe('drums');
        }
    });

    it('electronic percussion generates samples', () => {
        const samples = generateElectronicPerc();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('drums');
        }
    });

    it('risers pack generates samples', () => {
        const samples = generateRisersPack();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('fx');
        }
    });

    it('impacts pack generates samples', () => {
        const samples = generateImpactsPack();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('fx');
        }
    });

    it('world percussion has unique IDs', () => {
        const samples = generateWorldPerc();
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('risers have unique IDs', () => {
        const samples = generateRisersPack();
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
