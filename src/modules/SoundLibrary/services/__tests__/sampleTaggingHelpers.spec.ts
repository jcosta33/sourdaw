import { describe, it, expect } from 'vitest';
import { autoTagSample, generateFingerprint, getNextSampleId } from '../sampleTaggingHelpers';

describe('sampleTaggingHelpers', () => {
    describe('autoTagSample', () => {
        it('should tag a kick sample correctly', () => {
            const result = autoTagSample('heavy_kick.wav', '/samples/drums/kick/');
            expect(result.category).toBe('kicks');
            expect(result.tags.map(t => t.name)).toContain('kick');
            expect(result.tags.map(t => t.name)).toContain('low-end');
        });

        it('should tag a hi-hat sample correctly', () => {
            const result = autoTagSample('closed_hh.wav', '/samples/drums/hats/');
            expect(result.category).toBe('hi-hats');
            expect(result.tags.map(t => t.name)).toContain('hi-hat');
        });

        it('should combine tags from multiple rules', () => {
            const result = autoTagSample('bass_loop.wav', '/samples/loops/');
            // Matches 'bass' and 'loop' rules
            const tagNames = result.tags.map(t => t.name);
            expect(tagNames).toContain('bass');
            expect(tagNames).toContain('loop');
            expect(tagNames).toContain('low-end');
            expect(tagNames).toContain('rhythmic');
        });

        it('should return other category if no rules match', () => {
            const result = autoTagSample('unknown.wav', '/some/path/');
            expect(result.category).toBe('other');
            expect(result.tags).toEqual([]);
        });
    });

    describe('generateFingerprint', () => {
        it('should generate consistent fingerprints for the same input', () => {
            const f1 = generateFingerprint('test.wav', '/path/a');
            const f2 = generateFingerprint('test.wav', '/path/a');
            expect(f1).toBe(f2);
            expect(f1.startsWith('fp-')).toBe(true);
        });

        it('should generate different fingerprints for different inputs', () => {
            const f1 = generateFingerprint('test1.wav', '/path/a');
            const f2 = generateFingerprint('test2.wav', '/path/a');
            expect(f1).not.toBe(f2);
        });
    });

    describe('getNextSampleId', () => {
        it('should increment the sample ID on each call', () => {
            const id1 = getNextSampleId();
            const id2 = getNextSampleId();
            expect(id1).not.toBe(id2);
            expect(id1.startsWith('sample-')).toBe(true);
            
            const num1 = parseInt(id1.split('-')[1]!);
            const num2 = parseInt(id2.split('-')[1]!);
            expect(num2).toBe(num1 + 1);
        });
    });
});
