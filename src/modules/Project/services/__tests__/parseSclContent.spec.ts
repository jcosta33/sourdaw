import { describe, expect, it } from 'vitest';

import { parseSclContent } from '../parseSclContent';

import references from './fixtures/scalaParity.json';

describe('parseSclContent', () => {
    it.each(references.parsed)('parses the fixed reference $id', (reference) => {
        const result = parseSclContent(reference.content);

        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') {
            throw new Error(result.error.reason);
        }
        expect(result.scale.name).toBe(reference.name);
        expect(result.scale.description).toBe(reference.description);
        expect(result.scale.frequencies).toHaveLength(128);
        expect(reference.frequencies).toHaveLength(128);
        expect(references.reference.absoluteToleranceHz).toBe(1e-9);
        for (const [note, frequency] of result.scale.frequencies.entries()) {
            expect(Number.isFinite(frequency)).toBe(true);
            expect(frequency).toBeGreaterThan(0);
            expect(Math.abs(frequency - reference.frequencies[note]!)).toBeLessThan(1e-9);
        }
    });

    it.each(references.invalid)('preserves the structured error $id', (reference) => {
        expect(parseSclContent(reference.content)).toEqual({ status: 'invalid', error: reference.error });
    });

    it.each(references.rejected)('rejects the unrepresentable table $id', (reference) => {
        expect(() => parseSclContent(reference.content)).toThrow(reference.errorPrefix);
    });
});
