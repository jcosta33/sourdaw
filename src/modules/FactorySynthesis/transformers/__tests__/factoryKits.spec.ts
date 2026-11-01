import { describe, it, expect } from 'vitest';

import { generateBassPack } from '../bass';
import { generate808Kit } from '../drums808';
import { generate909Kit } from '../drums909';
import { generateLofiKit } from '../drumsLofi';
import { generateKeysPack } from '../keys';

describe('Factory synthesis kits', () => {
    it('808 kit generates samples', () => {
        const samples = generate808Kit();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.id).toBeTruthy();
            expect(s.name).toBeTruthy();
            expect(s.category).toBe('drums');
            expect(s.channels).toHaveLength(1);
            expect(s.tags.length).toBeGreaterThan(0);
        }
    });

    it('909 kit generates samples', () => {
        const samples = generate909Kit();
        expect(samples.length).toBeGreaterThan(0);
    });

    it('lofi kit generates samples', () => {
        const samples = generateLofiKit();
        expect(samples.length).toBeGreaterThan(0);
    });

    it('bass generates samples', () => {
        const samples = generateBassPack();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('bass');
        }
    });

    it('keys generates samples', () => {
        const samples = generateKeysPack();
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('keys');
        }
    });

    it('all 808 samples have unique ids', () => {
        const samples = generate808Kit();
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('all 808 sample channels have positive length', () => {
        const samples = generate808Kit();
        for (const s of samples) {
            expect(s.channels[0]!.length).toBeGreaterThan(0);
        }
    });
});
